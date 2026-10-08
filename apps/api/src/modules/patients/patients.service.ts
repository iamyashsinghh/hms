import { Injectable } from '@nestjs/common';
import { iso, type Tx } from '@hms/db';
import { todayIso, type CreatePatient, type Paginated, type Patient, type UpdatePatient } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { AuditService } from '../../common/db/audit.service';
import { OutboxService } from '../../common/events/outbox.service';
import { currentContext } from '../../common/context/request-context';
import { conflict, notFound } from '../../common/errors/errors';

/** Options for registrations and edits made from the patient screens. */
export interface PatientWriteOptions {
  /** Refuse an ABHA number that another active patient already holds. */
  uniqueAbha?: boolean;
}
import { SetupService } from '../setup/setup.service';
import { PatientsRepository, type NewPatientRow, type PatientRow } from './patients.repository';

@Injectable()
export class PatientsService {
  constructor(
    private readonly db: DbService,
    private readonly repo: PatientsRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly setup: SetupService,
  ) {}

  search(q: string | undefined, page: number, pageSize: number): Promise<Paginated<Patient>> {
    return this.db.tx(async (tx) => {
      const { items, total } = await this.repo.search(tx, q, page, pageSize);
      return { items: items.map(toDto), page, pageSize, total };
    });
  }

  get(id: string): Promise<Patient> {
    return this.db.tx(async (tx) => {
      const row = await this.repo.findById(tx, id);
      if (!row) throw notFound('Patient');
      await this.audit.recordView(tx, 'patient', id);
      return toDto(row);
    });
  }

  create(input: CreatePatient, opts: PatientWriteOptions = {}): Promise<Patient> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      if (opts.uniqueAbha && input.abhaNumber) await this.assertAbhaFree(tx, input.abhaNumber);
      // Prefix and width come from the hospital's number-series settings (Setup).
      const uhid = await this.setup.nextNumber(tx, 'uhid', { prefix: 'UH' });
      const row = await this.repo.insert(tx, {
        ...toColumns(input),
        tenantId: ctx.tenantId!,
        uhid,
        firstName: input.firstName,
        gender: input.gender,
        registeredFacilityId: ctx.facilityId ?? null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      });
      await this.outbox.publish(tx, 'core.patient.registered', { patientId: row.id, uhid });
      return toDto(row);
    });
  }

  update(id: string, input: UpdatePatient, opts: PatientWriteOptions = {}): Promise<Patient> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      if (opts.uniqueAbha && input.abhaNumber) {
        if (!(await this.repo.findById(tx, id))) throw notFound('Patient');
        await this.assertAbhaFree(tx, input.abhaNumber, id);
      }
      const row = await this.repo.update(tx, id, { ...toColumns(input), updatedBy: ctx.userId });
      if (!row) throw notFound('Patient');
      return toDto(row);
    });
  }

  private async assertAbhaFree(tx: Tx, abhaNumber: string, excludeId?: string) {
    const clash = await this.repo.findActiveByAbha(tx, abhaNumber, excludeId);
    if (clash) throw conflict('abha_in_use', `This ABHA number is already linked to ${clash.uhid}; merge the records instead`);
  }

  /**
   * Retire a duplicate record into the surviving one. Runs inside the caller's transaction
   * (the front-office merge flow); moving visits, bills etc. is each owning module's job.
   * Publishes `core.patient.merged {sourceId, targetId}`.
   */
  async markMerged(tx: Tx, sourceId: string, targetId: string): Promise<Patient> {
    if (sourceId === targetId) throw conflict('merge_same_patient', 'Cannot merge a patient into itself');
    const [source, target] = await Promise.all([this.repo.findById(tx, sourceId), this.repo.findById(tx, targetId)]);
    if (!source || !target) throw notFound('Patient');
    if (!source.isActive || source.mergedIntoId) throw conflict('already_merged', `${source.uhid} has already been merged`);
    if (!target.isActive) throw conflict('merge_target_inactive', `${target.uhid} is not an active record`);
    const row = await this.repo.update(tx, sourceId, {
      isActive: false,
      mergedIntoId: targetId,
      updatedBy: currentContext()?.userId ?? null,
    });
    await this.outbox.publish(tx, 'core.patient.merged', { sourceId, targetId });
    return toDto(row!);
  }
}

function toColumns(input: UpdatePatient): Partial<NewPatientRow> {
  const out: Partial<NewPatientRow> = {};
  if (input.firstName !== undefined) out.firstName = input.firstName;
  if (input.lastName !== undefined) out.lastName = input.lastName || null;
  if (input.gender !== undefined) out.gender = input.gender;
  if (input.dateOfBirth !== undefined) out.dateOfBirth = input.dateOfBirth;
  else if (input.ageYears !== undefined) {
    // Approximate DOB: today's date (India time) that many years ago.
    const today = todayIso();
    out.dateOfBirth = `${String(Number(today.slice(0, 4)) - input.ageYears).padStart(4, '0')}${today.slice(4)}`.replace(/-02-29$/, '-02-28');
  }
  if (input.mobile !== undefined) out.mobile = input.mobile;
  if (input.email !== undefined) out.email = input.email;
  if (input.bloodGroup !== undefined) out.bloodGroup = input.bloodGroup;
  if (input.abhaNumber !== undefined) out.abhaNumber = input.abhaNumber;
  if (input.address !== undefined) out.address = input.address;
  if (input.allergies !== undefined) out.allergies = input.allergies;
  return out;
}

export function toDto(r: PatientRow): Patient {
  return {
    id: r.id,
    uhid: r.uhid,
    firstName: r.firstName,
    lastName: r.lastName,
    gender: r.gender as Patient['gender'],
    dateOfBirth: r.dateOfBirth,
    mobile: r.mobile,
    email: r.email,
    bloodGroup: r.bloodGroup,
    abhaNumber: r.abhaNumber,
    address: r.address ?? undefined,
    allergies: r.allergies,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}
