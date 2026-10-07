import { Injectable } from '@nestjs/common';
import { formatSeries, iso, nextCounter, type Tx } from '@hms/db';
import { emr, type Paginated, type Patient } from '@hms/shared';

type Addendum = emr.Addendum;
type AllergyConflict = emr.AllergyConflict;
type Certificate = emr.Certificate;
type CreateCertificate = emr.CreateCertificate;
type CreateEncounter = emr.CreateEncounter;
type Diagnosis = emr.Diagnosis;
type DiagnosesInput = emr.DiagnosesInput;
type Encounter = emr.Encounter;
type EncounterNotes = emr.EncounterNotes;
type EncounterPatient = emr.EncounterPatient;
type EncounterSignedEvent = emr.EncounterSignedEvent;
type EncounterStatus = emr.EncounterStatus;
type Favourite = emr.Favourite;
type FavouriteInput = emr.FavouriteInput;
type Order = emr.Order;
type OrdersInput = emr.OrdersInput;
type Prescription = emr.Prescription;
type PrescriptionCreatedEvent = emr.PrescriptionCreatedEvent;
type PrescriptionInput = emr.PrescriptionInput;
type QueueItem = emr.QueueItem;
type QuickPrescriptionResult = emr.QuickPrescriptionResult;
type TimelineEntry = emr.TimelineEntry;
type UpdateEncounter = emr.UpdateEncounter;
type Vitals = emr.Vitals;
type VitalsInput = emr.VitalsInput;

import { DbService } from '../../common/db/db.service';
import { AuditService } from '../../common/db/audit.service';
import { OutboxService } from '../../common/events/outbox.service';
import { currentContext } from '../../common/context/request-context';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../common/errors/errors';
import { PatientsService } from '../patients/patients.service';
import {
  EmrRepository,
  type AddendumRow,
  type CertificateRow,
  type DiagnosisRow,
  type EncounterRow,
  type OrderRow,
  type PrescriptionLineRow,
  type PrescriptionRow,
  type VitalsRow,
} from './emr.repository';
import { matchAllergies } from './allergy';

const num = (v: string | null): number | null => (v === null ? null : Number(v));
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/** Payload of frontoffice.visit.checked_in (owned by frontoffice; see PARALLEL_PLAN.md section 4). */
export interface VisitCheckedIn {
  visitId: string;
  appointmentId?: string | null;
  patientId: string;
  doctorId: string;
  facilityId: string;
  tokenNo?: number | null;
}

@Injectable()
export class EmrService {
  constructor(
    private readonly db: DbService,
    private readonly repo: EmrRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly patients: PatientsService,
  ) {}

  /** Runs a transaction and turns the database's sign-lock errors into a clean 409. */
  private tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.tx(fn).catch((e: unknown) => {
      if (hasHint(e, 'emr_signed_locked')) throw conflict('encounter_signed', 'This consultation is signed and locked. Add an addendum instead.');
      throw e;
    });
  }

  // ---------- encounters ----------

  /** Opens a consultation. Idempotent per visitId (check-in events can arrive more than once). */
  async open(input: CreateEncounter, facilityHint?: string): Promise<Encounter> {
    const ctx = currentContext()!;
    const doctorId = input.doctorId ?? ctx.userId;
    if (!doctorId) throw badRequest('doctor_required', 'Choose the doctor for this consultation');
    if (input.visitId) {
      const existing = await this.db.tx((tx) => this.repo.findByVisit(tx, input.visitId!));
      if (existing) return this.get(existing.id, false);
    }
    const patient = await this.patients.get(input.patientId);
    const id = await this.db.tx(async (tx) => {
      const facilityId = ctx.facilityId ?? facilityHint ?? (await this.repo.soleFacilityId(tx));
      if (!facilityId) throw badRequest('facility_required', 'Pick the facility you are working in');
      const row = await this.repo.insertEncounter(tx, {
        tenantId: ctx.tenantId!,
        encounterNo: formatSeries('OP', await nextCounter(tx, 'emr.encounter')),
        facilityId,
        patientId: patient.id,
        doctorId,
        visitId: input.visitId ?? null,
        appointmentId: input.appointmentId ?? null,
        tokenNo: input.tokenNo ?? null,
        ...patientSnapshot(patient),
        createdBy: ctx.userId ?? null,
        updatedBy: ctx.userId ?? null,
      });
      return row.id;
    });
    return this.get(id, false);
  }

  /** Handler for frontoffice.visit.checked_in: put the patient in the doctor's queue. */
  openFromCheckIn(e: VisitCheckedIn): Promise<Encounter> {
    return this.open(
      { patientId: e.patientId, doctorId: e.doctorId, visitId: e.visitId, appointmentId: e.appointmentId ?? undefined, tokenNo: e.tokenNo ?? undefined },
      e.facilityId,
    );
  }

  async get(id: string, recordView = true): Promise<Encounter> {
    return this.tx(async (tx) => {
      const row = await this.repo.findEncounter(tx, id);
      if (!row) throw notFound('Consultation');
      if (recordView) await this.audit.recordView(tx, 'encounter', id);
      return this.fullDto(tx, row);
    });
  }

  queue(date: string | undefined, doctorId: string | undefined): Promise<{ items: QueueItem[] }> {
    const ctx = currentContext()!;
    const doctor = doctorId ?? ctx.userId!;
    return this.tx(async (tx) => {
      const rows = await this.repo.queue(tx, doctor, date ?? today());
      return { items: rows.map(toQueueItem) };
    });
  }

  start(id: string): Promise<Encounter> {
    return this.mutate(id, { doctorOnly: true }, async (tx, enc) => {
      if (enc.status === 'waiting') {
        return this.repo.updateEncounter(tx, id, { status: 'in_progress', startedAt: new Date().toISOString(), updatedBy: currentContext()!.userId });
      }
      return enc;
    });
  }

  update(id: string, input: UpdateEncounter): Promise<Encounter> {
    return this.mutate(id, { doctorOnly: true }, async (tx, enc) => {
      const values: Partial<EncounterRow> = { ...startIfWaiting(enc), updatedBy: currentContext()!.userId };
      if (input.notes !== undefined) values.notes = clean({ ...(enc.notes as EncounterNotes), ...input.notes });
      if (input.followUpDate !== undefined) values.followUpDate = input.followUpDate;
      if (input.followUpNotes !== undefined) values.followUpNotes = input.followUpNotes || null;
      return this.repo.updateEncounter(tx, id, values);
    });
  }

  addVitals(id: string, input: VitalsInput): Promise<Encounter> {
    return this.mutate(id, { doctorOnly: false }, async (tx, enc) => {
      const ctx = currentContext()!;
      const bmi = input.weightKg && input.heightCm ? Math.round((input.weightKg / (input.heightCm / 100) ** 2) * 10) / 10 : null;
      await this.repo.insertVitals(tx, {
        tenantId: ctx.tenantId!,
        encounterId: id,
        temperatureC: input.temperatureC?.toString(),
        pulse: input.pulse,
        respRate: input.respRate,
        bpSystolic: input.bpSystolic,
        bpDiastolic: input.bpDiastolic,
        spo2: input.spo2,
        weightKg: input.weightKg?.toString(),
        heightCm: input.heightCm?.toString(),
        bmi: bmi === null || bmi > 999 ? null : bmi.toString(),
        bloodSugar: input.bloodSugar,
        painScore: input.painScore,
        notes: input.notes,
        recordedBy: ctx.userId,
      });
      return enc;
    });
  }

  setDiagnoses(id: string, input: DiagnosesInput): Promise<Encounter> {
    const parsed = emr.diagnosesInputSchema.parse(input);
    return this.mutate(id, { doctorOnly: true }, async (tx, enc) => {
      const tenantId = currentContext()!.tenantId!;
      const hasPrimary = parsed.diagnoses.some((d) => d.isPrimary);
      await this.repo.replaceDiagnoses(
        tx,
        id,
        parsed.diagnoses.map((d, i) => ({
          tenantId,
          encounterId: id,
          sort: i,
          icd10Code: d.icd10Code ?? null,
          description: d.description,
          kind: d.kind,
          isPrimary: hasPrimary ? d.isPrimary : i === 0,
        })),
      );
      return this.touch(tx, enc);
    });
  }

  setOrders(id: string, input: OrdersInput): Promise<Encounter> {
    const parsed = emr.ordersInputSchema.parse(input);
    return this.mutate(id, { doctorOnly: true }, async (tx, enc) => {
      const tenantId = currentContext()!.tenantId!;
      await this.repo.replaceOrders(
        tx,
        id,
        parsed.orders.map((o, i) => ({
          tenantId,
          encounterId: id,
          patientId: enc.patientId,
          sort: i,
          kind: o.kind,
          code: o.code ?? null,
          name: o.name,
          priority: o.priority,
          notes: o.notes ?? null,
        })),
      );
      return this.touch(tx, enc);
    });
  }

  /**
   * Replaces the consultation's prescription. Lines that match a recorded allergy need an
   * allergyOverrideReason, otherwise the whole save is rejected with 409 allergy_conflict.
   */
  async setPrescription(id: string, input: PrescriptionInput): Promise<Encounter> {
    const parsed = emr.prescriptionInputSchema.parse(input);
    const enc = await this.db.tx((tx) => this.repo.findEncounter(tx, id));
    if (!enc) throw notFound('Consultation');
    // Allergies come from the live patient record, not the snapshot, so a new allergy is never missed.
    const patient = await this.patients.get(enc.patientId);
    const conflicts: AllergyConflict[] = [];
    parsed.lines.forEach((l, i) => {
      if (l.allergyOverrideReason) return;
      const allergy = matchAllergies(patient.allergies ?? [], [l.drugName, l.genericName]);
      if (allergy) conflicts.push({ line: i, drugName: l.drugName, allergy });
    });
    if (conflicts.length) {
      throw new AppError(409, 'allergy_conflict', `Patient is allergic to ${conflicts.map((c) => c.allergy).join(', ')}`, { conflicts });
    }
    return this.mutate(id, { doctorOnly: true }, async (tx, fresh) => {
      const ctx = currentContext()!;
      const [existing] = await this.repo.prescriptionsFor(tx, [id]);
      if (!parsed.lines.length) {
        if (existing) await this.repo.deletePrescription(tx, existing.id);
      } else {
        const rx = existing
          ? await this.repo.updatePrescription(tx, existing.id, { notes: parsed.notes ?? null, updatedBy: ctx.userId })
          : await this.repo.insertPrescription(tx, {
              tenantId: ctx.tenantId!,
              rxNo: formatSeries('RX', await nextCounter(tx, 'emr.rx')),
              encounterId: id,
              patientId: fresh.patientId,
              doctorId: fresh.doctorId,
              facilityId: fresh.facilityId,
              notes: parsed.notes ?? null,
              createdBy: ctx.userId,
              updatedBy: ctx.userId,
            });
        await this.repo.replaceLines(
          tx,
          rx.id,
          parsed.lines.map((l, i) => ({
            tenantId: ctx.tenantId!,
            prescriptionId: rx.id,
            sort: i,
            drugName: l.drugName,
            itemCode: l.itemCode ?? null,
            genericName: l.genericName ?? null,
            form: l.form ?? null,
            strength: l.strength ?? null,
            dose: l.dose,
            route: l.route,
            frequency: l.frequency,
            timing: l.timing ?? null,
            days: l.days ?? null,
            qty: (l.qty ?? emr.suggestQty(l.frequency, l.days))?.toString() ?? null,
            instructions: l.instructions ?? null,
            allergyOverrideReason: l.allergyOverrideReason ?? null,
          })),
        );
      }
      return this.repo.updateEncounter(tx, id, {
        ...startIfWaiting(fresh),
        patientAllergies: patient.allergies ?? [],
        updatedBy: ctx.userId,
      });
    });
  }

  /** Signs and locks the consultation; publishes emr.encounter.signed and emr.prescription.created. */
  sign(id: string): Promise<Encounter> {
    return this.mutate(id, { doctorOnly: true }, async (tx, enc) => {
      const ctx = currentContext()!;
      const [diagnoses, [rx]] = await Promise.all([this.repo.diagnoses(tx, [id]), this.repo.prescriptionsFor(tx, [id])]);
      const notes = enc.notes as EncounterNotes;
      if (!diagnoses.length && !rx && !notes.chiefComplaints && !notes.examination) {
        throw badRequest('encounter_empty', 'Add complaints, a diagnosis or a prescription before signing');
      }
      const signed = await this.repo.updateEncounter(tx, id, {
        status: 'completed',
        startedAt: enc.startedAt ?? new Date().toISOString(),
        signedAt: new Date().toISOString(),
        signedBy: ctx.userId,
        updatedBy: ctx.userId,
      });
      const signedEvent: EncounterSignedEvent = {
        encounterId: id,
        patientId: enc.patientId,
        doctorId: enc.doctorId,
        followUpDate: enc.followUpDate,
        followUpNotes: enc.followUpNotes,
      };
      await this.outbox.publish(tx, 'emr.encounter.signed', { ...signedEvent });
      if (rx) {
        const [lines, names] = await Promise.all([this.repo.lines(tx, [rx.id]), this.repo.userNames(tx, [rx.doctorId])]);
        const event: PrescriptionCreatedEvent = {
          prescriptionId: rx.id,
          patientId: enc.patientId,
          doctorId: rx.doctorId,
          doctorName: names.get(rx.doctorId) ?? null,
          createdAt: iso(rx.createdAt),
          lines: lines.map((l) => ({
            drugName: l.drugName,
            ...(l.itemCode ? { itemCode: l.itemCode } : {}),
            dose: l.dose,
            frequency: l.frequency,
            days: l.days,
            qty: num(l.qty),
          })),
        };
        await this.outbox.publish(tx, 'emr.prescription.created', { ...event });
      }
      return signed;
    });
  }

  cancel(id: string): Promise<Encounter> {
    return this.mutate(id, { doctorOnly: true }, (tx, enc) =>
      this.repo.updateEncounter(tx, enc.id, { status: 'cancelled', cancelledAt: new Date().toISOString(), updatedBy: currentContext()!.userId }),
    );
  }

  /** Corrections after signing. Addenda are append-only. */
  addAddendum(id: string, text: string): Promise<Encounter> {
    return this.tx(async (tx) => {
      const ctx = currentContext()!;
      const enc = await this.repo.findEncounter(tx, id);
      if (!enc) throw notFound('Consultation');
      if (enc.status !== 'completed') throw conflict('encounter_not_signed', 'Edit the consultation directly until it is signed');
      await this.repo.insertAddendum(tx, { tenantId: ctx.tenantId!, encounterId: id, text, createdBy: ctx.userId });
      return this.fullDto(tx, enc);
    });
  }

  /** Quick Rx for the mobile doctor app: opens a walk-in consultation when needed, saves the Rx, optionally signs. */
  async quickPrescription(input: ReturnType<typeof emr.quickPrescriptionSchema.parse>): Promise<QuickPrescriptionResult> {
    let encounterId: string;
    if (input.encounterId) {
      const enc = await this.db.tx((tx) => this.repo.findEncounter(tx, input.encounterId!));
      if (!enc || enc.patientId !== input.patientId) throw notFound('Consultation');
      encounterId = enc.id;
    } else {
      encounterId = (await this.open({ patientId: input.patientId })).id;
    }
    await this.setPrescription(encounterId, { lines: input.lines, notes: input.notes });
    if (input.advice !== undefined || input.followUpDate !== undefined) {
      await this.update(encounterId, {
        ...(input.advice !== undefined ? { notes: { advice: input.advice } } : {}),
        ...(input.followUpDate !== undefined ? { followUpDate: input.followUpDate } : {}),
      });
    }
    const enc = input.sign ? await this.sign(encounterId) : await this.get(encounterId, false);
    return { prescriptionId: enc.prescription!.id, encounterId, rxNo: enc.prescription!.rxNo };
  }

  // ---------- reads ----------

  timeline(patientId: string, page: number, pageSize: number): Promise<Paginated<TimelineEntry>> {
    return this.tx(async (tx) => {
      const { items, total } = await this.repo.byPatient(tx, patientId, page, pageSize);
      const ids = items.map((e) => e.id);
      const [vitals, diagnoses, orders, rxs, names] = await Promise.all([
        this.repo.vitals(tx, ids),
        this.repo.diagnoses(tx, ids),
        this.repo.orders(tx, ids),
        this.repo.prescriptionsFor(tx, ids),
        this.repo.userNames(tx, items.map((e) => e.doctorId)),
      ]);
      const lines = await this.repo.lines(tx, rxs.map((r) => r.id));
      await this.audit.recordView(tx, 'patient_timeline', patientId);
      return {
        page,
        pageSize,
        total,
        items: items.map((e): TimelineEntry => {
          const rx = rxs.find((r) => r.encounterId === e.id);
          const v = vitals.filter((x) => x.encounterId === e.id).at(-1);
          return {
            encounterId: e.id,
            encounterNo: e.encounterNo,
            encounterDate: e.encounterDate,
            status: e.status as EncounterStatus,
            doctorId: e.doctorId,
            doctorName: names.get(e.doctorId) ?? null,
            chiefComplaints: (e.notes as EncounterNotes).chiefComplaints ?? null,
            diagnoses: diagnoses.filter((d) => d.encounterId === e.id).map(({ icd10Code, description, kind, isPrimary }) => ({
              icd10Code, description, kind: kind as Diagnosis['kind'], isPrimary,
            })),
            medicines: rx ? lines.filter((l) => l.prescriptionId === rx.id).map(({ drugName, dose, frequency, days }) => ({ drugName, dose, frequency, days })) : [],
            orders: orders.filter((o) => o.encounterId === e.id).map((o) => ({ kind: o.kind as Order['kind'], name: o.name })),
            vitals: v ? toVitals(v) : null,
            followUpDate: e.followUpDate,
            signedAt: e.signedAt && iso(e.signedAt),
          };
        }),
      };
    });
  }

  getPrescription(id: string): Promise<Prescription> {
    return this.tx(async (tx) => {
      const rx = await this.repo.findPrescription(tx, id);
      if (!rx) throw notFound('Prescription');
      await this.audit.recordView(tx, 'prescription', id);
      return toPrescription(rx, await this.repo.lines(tx, [rx.id]));
    });
  }

  // ---------- favourites ----------

  listFavourites(): Promise<Favourite[]> {
    return this.tx(async (tx) => (await this.repo.favourites(tx, currentContext()!.userId!)).map(toFavourite));
  }

  createFavourite(input: FavouriteInput): Promise<Favourite> {
    const parsed = emr.favouriteInputSchema.parse(input);
    const ctx = currentContext()!;
    return this.tx(async (tx) =>
      toFavourite(await this.repo.insertFavourite(tx, { tenantId: ctx.tenantId!, doctorId: ctx.userId!, name: parsed.name, lines: parsed.lines })),
    );
  }

  deleteFavourite(id: string): Promise<void> {
    return this.tx(async (tx) => {
      if (!(await this.repo.deleteFavourite(tx, id, currentContext()!.userId!))) throw notFound('Favourite');
    });
  }

  // ---------- certificates ----------

  async createCertificate(input: CreateCertificate): Promise<Certificate> {
    const ctx = currentContext()!;
    const patient = await this.patients.get(input.patientId);
    const id = await this.tx(async (tx) => {
      let facilityId = ctx.facilityId ?? null;
      if (input.encounterId) {
        const enc = await this.repo.findEncounter(tx, input.encounterId);
        if (!enc || enc.patientId !== input.patientId) throw notFound('Consultation');
        facilityId ??= enc.facilityId;
      }
      facilityId ??= await this.repo.soleFacilityId(tx);
      if (!facilityId) throw badRequest('facility_required', 'Pick the facility you are working in');
      const snap = patientSnapshot(patient);
      const row = await this.repo.insertCertificate(tx, {
        tenantId: ctx.tenantId!,
        certificateNo: formatSeries('MC', await nextCounter(tx, 'emr.certificate')),
        kind: input.kind,
        patientId: patient.id,
        encounterId: input.encounterId ?? null,
        doctorId: ctx.userId!,
        facilityId,
        patientUhid: snap.patientUhid,
        patientName: snap.patientName,
        patientGender: snap.patientGender,
        patientDob: snap.patientDob,
        fromDate: input.fromDate ?? null,
        toDate: input.toDate ?? null,
        diagnosis: input.diagnosis ?? null,
        remarks: input.remarks ?? null,
      });
      return row.id;
    });
    return this.getCertificate(id);
  }

  getCertificate(id: string): Promise<Certificate> {
    return this.tx(async (tx) => {
      const row = await this.repo.findCertificate(tx, id);
      if (!row) throw notFound('Certificate');
      const names = await this.repo.userNames(tx, [row.doctorId]);
      return toCertificate(row, names);
    });
  }

  listCertificates(patientId: string): Promise<Certificate[]> {
    return this.tx(async (tx) => {
      const rows = await this.repo.certificatesFor(tx, patientId);
      const names = await this.repo.userNames(tx, rows.map((r) => r.doctorId));
      return rows.map((r) => toCertificate(r, names));
    });
  }

  // ---------- helpers ----------

  /** Loads the encounter under a row lock, checks it is still editable, runs fn, returns the full DTO. */
  private mutate(id: string, opts: { doctorOnly: boolean }, fn: (tx: Tx, enc: EncounterRow) => Promise<EncounterRow>): Promise<Encounter> {
    return this.tx(async (tx) => {
      const ctx = currentContext()!;
      const enc = await this.repo.findEncounter(tx, id, true);
      if (!enc) throw notFound('Consultation');
      if (enc.status === 'completed') throw conflict('encounter_signed', 'This consultation is signed and locked. Add an addendum instead.');
      if (enc.status === 'cancelled') throw conflict('encounter_cancelled', 'This consultation was cancelled');
      if (opts.doctorOnly && enc.doctorId !== ctx.userId) throw forbidden('Only the consulting doctor can change this consultation');
      const updated = await fn(tx, enc);
      return this.fullDto(tx, updated);
    });
  }

  private touch(tx: Tx, enc: EncounterRow): Promise<EncounterRow> {
    return this.repo.updateEncounter(tx, enc.id, { ...startIfWaiting(enc), updatedBy: currentContext()!.userId });
  }

  private async fullDto(tx: Tx, e: EncounterRow): Promise<Encounter> {
    const [vitals, diagnoses, orders, rxs, addenda] = await Promise.all([
      this.repo.vitals(tx, [e.id]),
      this.repo.diagnoses(tx, [e.id]),
      this.repo.orders(tx, [e.id]),
      this.repo.prescriptionsFor(tx, [e.id]),
      this.repo.addenda(tx, e.id),
    ]);
    const rx = rxs[0];
    const [lines, names] = await Promise.all([
      rx ? this.repo.lines(tx, [rx.id]) : Promise.resolve([]),
      this.repo.userNames(tx, [e.doctorId, ...addenda.map((a) => a.createdBy ?? '')]),
    ]);
    return {
      ...toSummary(e, names),
      appointmentId: e.appointmentId,
      notes: e.notes as EncounterNotes,
      followUpDate: e.followUpDate,
      followUpNotes: e.followUpNotes,
      signedBy: e.signedBy,
      vitals: vitals.map(toVitals),
      diagnoses: diagnoses.map(toDiagnosis),
      prescription: rx ? toPrescription(rx, lines) : null,
      orders: orders.map(toOrder),
      addenda: addenda.map((a) => toAddendum(a, names)),
      updatedAt: iso(e.updatedAt),
    };
  }
}

// ---------- mapping ----------

function hasHint(e: unknown, hint: string): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 3 && cur && typeof cur === 'object'; i++) {
    if ((cur as { hint?: unknown }).hint === hint) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

function clean(notes: EncounterNotes): EncounterNotes {
  return Object.fromEntries(Object.entries(notes).filter(([, v]) => typeof v === 'string' && v.trim() !== '')) as EncounterNotes;
}

function startIfWaiting(enc: EncounterRow): Partial<EncounterRow> {
  return enc.status === 'waiting' ? { status: 'in_progress', startedAt: new Date().toISOString() } : {};
}

function patientSnapshot(p: Patient) {
  return {
    patientUhid: p.uhid,
    patientName: [p.firstName, p.lastName].filter(Boolean).join(' '),
    patientGender: p.gender,
    patientDob: p.dateOfBirth,
    patientMobile: p.mobile,
    patientAllergies: p.allergies ?? [],
  };
}

function toPatient(e: EncounterRow): EncounterPatient {
  return {
    id: e.patientId,
    uhid: e.patientUhid,
    name: e.patientName,
    gender: e.patientGender,
    dateOfBirth: e.patientDob,
    mobile: e.patientMobile,
    allergies: e.patientAllergies,
  };
}

function toSummary(e: EncounterRow, names: Map<string, string>) {
  return {
    id: e.id,
    encounterNo: e.encounterNo,
    encounterDate: e.encounterDate,
    status: e.status as EncounterStatus,
    tokenNo: e.tokenNo,
    patient: toPatient(e),
    doctorId: e.doctorId,
    doctorName: names.get(e.doctorId) ?? null,
    facilityId: e.facilityId,
    visitId: e.visitId,
    startedAt: e.startedAt && iso(e.startedAt),
    signedAt: e.signedAt && iso(e.signedAt),
    createdAt: iso(e.createdAt),
  };
}

function toQueueItem(e: EncounterRow): QueueItem {
  return {
    encounterId: e.id,
    encounterNo: e.encounterNo,
    visitId: e.visitId,
    patientId: e.patientId,
    uhid: e.patientUhid,
    patientName: e.patientName,
    gender: e.patientGender,
    dateOfBirth: e.patientDob,
    tokenNo: e.tokenNo,
    status: e.status as EncounterStatus,
    checkedInAt: iso(e.createdAt),
    startedAt: e.startedAt && iso(e.startedAt),
    signedAt: e.signedAt && iso(e.signedAt),
  };
}

function toVitals(v: VitalsRow): Vitals {
  const opt = <T>(x: T | null) => (x === null ? undefined : x);
  return {
    id: v.id,
    encounterId: v.encounterId,
    temperatureC: opt(num(v.temperatureC)),
    pulse: opt(v.pulse),
    respRate: opt(v.respRate),
    bpSystolic: opt(v.bpSystolic),
    bpDiastolic: opt(v.bpDiastolic),
    spo2: opt(v.spo2),
    weightKg: opt(num(v.weightKg)),
    heightCm: opt(num(v.heightCm)),
    bmi: num(v.bmi),
    bloodSugar: opt(v.bloodSugar),
    painScore: opt(v.painScore),
    notes: opt(v.notes),
    recordedAt: iso(v.recordedAt),
    recordedBy: v.recordedBy,
  };
}

function toDiagnosis(d: DiagnosisRow): Diagnosis {
  return { id: d.id, icd10Code: d.icd10Code, description: d.description, kind: d.kind as Diagnosis['kind'], isPrimary: d.isPrimary };
}

function toOrder(o: OrderRow): Order {
  return { id: o.id, kind: o.kind as Order['kind'], code: o.code, name: o.name, priority: o.priority as Order['priority'], notes: o.notes, status: o.status };
}

function toPrescription(rx: PrescriptionRow, lines: PrescriptionLineRow[]): Prescription {
  return {
    id: rx.id,
    rxNo: rx.rxNo,
    encounterId: rx.encounterId,
    patientId: rx.patientId,
    doctorId: rx.doctorId,
    notes: rx.notes,
    createdAt: iso(rx.createdAt),
    lines: lines
      .filter((l) => l.prescriptionId === rx.id)
      .map((l) => ({
        id: l.id,
        drugName: l.drugName,
        itemCode: l.itemCode,
        genericName: l.genericName,
        form: l.form,
        strength: l.strength,
        dose: l.dose,
        route: l.route,
        frequency: l.frequency,
        timing: l.timing,
        days: l.days,
        qty: num(l.qty),
        instructions: l.instructions,
        allergyOverrideReason: l.allergyOverrideReason,
      })),
  };
}

function toAddendum(a: AddendumRow, names: Map<string, string>): Addendum {
  return { id: a.id, text: a.text, createdBy: a.createdBy, createdByName: (a.createdBy && names.get(a.createdBy)) ?? null, createdAt: iso(a.createdAt) };
}

function toFavourite(f: { id: string; name: string; lines: unknown; createdAt: string }): Favourite {
  return { id: f.id, name: f.name, lines: f.lines as Favourite['lines'], createdAt: iso(f.createdAt) };
}

function toCertificate(c: CertificateRow, names: Map<string, string>): Certificate {
  return {
    id: c.id,
    certificateNo: c.certificateNo,
    kind: c.kind as Certificate['kind'],
    patient: {
      id: c.patientId,
      uhid: c.patientUhid,
      name: c.patientName,
      gender: c.patientGender,
      dateOfBirth: c.patientDob,
      mobile: null,
      allergies: [],
    },
    encounterId: c.encounterId,
    doctorId: c.doctorId,
    doctorName: names.get(c.doctorId) ?? null,
    fromDate: c.fromDate,
    toDate: c.toDate,
    diagnosis: c.diagnosis,
    remarks: c.remarks,
    issuedAt: iso(c.issuedAt),
  };
}
