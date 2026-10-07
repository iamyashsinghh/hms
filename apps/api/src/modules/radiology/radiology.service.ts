import { Injectable, Logger } from '@nestjs/common';
import { formatSeries, iso, nextCounter, type Tx } from '@hms/db';
import { radiology, type Paginated } from '@hms/shared';
import type { z } from 'zod';
import { DbService } from '../../common/db/db.service';
import { AuditService } from '../../common/db/audit.service';
import { OutboxService } from '../../common/events/outbox.service';
import { currentContext } from '../../common/context/request-context';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors/errors';
import { BillingService } from '../billing/billing.service';
import { EmrService } from '../emr/emr.service';
import { PatientsService } from '../patients/patients.service';
import {
  RadiologyRepository,
  type ModalityRow,
  type NewOrderRow,
  type OrderRow,
  type ReportRow,
  type TemplateRow,
  type TestRow,
} from './radiology.repository';

type Modality = radiology.Modality;
type OrderStatus = radiology.OrderStatus;
type RadiologyOrder = radiology.RadiologyOrder;
type RadiologyReport = radiology.RadiologyReport;
type RadiologyTest = radiology.RadiologyTest;
type ReportTemplate = radiology.ReportTemplate;

const num = (v: string | null): number | null => (v === null ? null : Number(v));
const blank = <T>(v: T | undefined | null): T | null => (v === undefined || v === '' ? null : v);

/** Where an order may go next. Cancel is allowed from anything before a report is finalized. */
const STARTABLE: OrderStatus[] = ['ordered', 'scheduled'];
const COMPLETABLE: OrderStatus[] = ['ordered', 'scheduled', 'in_progress'];
const REPORTABLE: OrderStatus[] = ['in_progress', 'acquired', 'reported'];
const EDITABLE: OrderStatus[] = ['ordered', 'scheduled'];

/** Payload of emr.encounter.signed (owned by emr; see PARALLEL_PLAN.md section 4). */
export interface EncounterSigned {
  encounterId: string;
  patientId: string;
  doctorId: string;
}

/**
 * Radiology (RIS): modality and test masters, report templates, orders from EMR or the desk,
 * machine scheduling, scan workflow, versioned reports with sign-off, billing through BillingService.
 */
@Injectable()
export class RadiologyService {
  private readonly logger = new Logger(RadiologyService.name);

  constructor(
    private readonly db: DbService,
    private readonly repo: RadiologyRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly patients: PatientsService,
    private readonly billing: BillingService,
    private readonly emr: EmrService,
  ) {}

  /** Runs a transaction and turns database rule violations into clean 409s. */
  private tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.tx(fn).catch((e: unknown) => {
      if (hasHint(e, 'radiology_report_locked')) throw conflict('report_finalized', 'This report is finalized. Amend it to make changes.');
      const c = pgCode(e);
      if (c?.code === '23505') {
        if (c.constraint === 'modalities_code_uq') throw conflict('duplicate_code', 'A modality with this code already exists');
        if (c.constraint === 'tests_code_uq') throw conflict('duplicate_code', 'A test with this code already exists');
        if (c.constraint === 'templates_name_uq') throw conflict('duplicate_name', 'A template with this name already exists');
        if (c.constraint === 'reports_one_draft_uq') throw conflict('draft_exists', 'A draft report already exists for this order');
      }
      if (c?.code === '23503') throw badRequest('invalid_reference', 'A linked record (facility, modality or template) was not found');
      throw e;
    });
  }

  // ---------- modalities ----------

  listModalities(includeInactive: boolean): Promise<Modality[]> {
    return this.tx(async (tx) => (await this.repo.modalities(tx, includeInactive)).map(toModality));
  }

  createModality(input: radiology.ModalityInput): Promise<Modality> {
    const d = radiology.modalityInputSchema.parse(input);
    const ctx = currentContext()!;
    return this.tx(async (tx) =>
      toModality(
        await this.repo.insertModality(tx, {
          tenantId: ctx.tenantId!,
          code: d.code,
          name: d.name,
          kind: d.kind,
          facilityId: d.facilityId ?? null,
          room: blank(d.room),
          aeTitle: blank(d.aeTitle),
          isActive: d.isActive,
          createdBy: ctx.userId ?? null,
          updatedBy: ctx.userId ?? null,
        }),
      ),
    );
  }

  updateModality(id: string, input: radiology.UpdateModality): Promise<Modality> {
    const d = radiology.updateModalitySchema.parse(input);
    return this.tx(async (tx) => {
      const row = await this.repo.updateModality(tx, id, {
        ...pick(d, ['code', 'name', 'kind', 'facilityId', 'isActive']),
        ...(d.room !== undefined ? { room: blank(d.room) } : {}),
        ...(d.aeTitle !== undefined ? { aeTitle: blank(d.aeTitle) } : {}),
        updatedBy: currentContext()!.userId ?? null,
      });
      if (!row) throw notFound('Modality');
      return toModality(row);
    });
  }

  // ---------- tests ----------

  listTests(query: radiology.MasterQuery): Promise<RadiologyTest[]> {
    const q = radiology.masterQuerySchema.parse(query);
    return this.tx(async (tx) => (await this.repo.tests(tx, q)).map((r) => toTest(r.test, r.modalityCode, r.modalityName)));
  }

  getTest(id: string): Promise<RadiologyTest> {
    return this.tx(async (tx) => {
      const r = await this.repo.test(tx, id);
      if (!r) throw notFound('Radiology test');
      return toTest(r.test, r.modalityCode, r.modalityName);
    });
  }

  createTest(input: radiology.TestInput): Promise<RadiologyTest> {
    const d = radiology.testInputSchema.parse(input);
    if (!d.serviceCode && d.price === undefined) throw badRequest('price_required', 'Give a price or a billing service code');
    const ctx = currentContext()!;
    return this.tx(async (tx) => {
      const row = await this.repo.insertTest(tx, {
        tenantId: ctx.tenantId!,
        code: d.code,
        name: d.name,
        modalityId: d.modalityId,
        bodyPart: blank(d.bodyPart),
        serviceCode: blank(d.serviceCode),
        price: d.price === undefined ? null : d.price.toFixed(2),
        taxRate: d.taxRate.toFixed(2),
        durationMinutes: d.durationMinutes,
        contrast: d.contrast,
        preparation: blank(d.preparation),
        defaultTemplateId: d.defaultTemplateId ?? null,
        isActive: d.isActive,
        createdBy: ctx.userId ?? null,
        updatedBy: ctx.userId ?? null,
      });
      const r = (await this.repo.test(tx, row.id))!;
      return toTest(r.test, r.modalityCode, r.modalityName);
    });
  }

  updateTest(id: string, input: radiology.UpdateTest): Promise<RadiologyTest> {
    const d = radiology.updateTestSchema.parse(input);
    return this.tx(async (tx) => {
      const row = await this.repo.updateTest(tx, id, {
        ...pick(d, ['code', 'name', 'modalityId', 'durationMinutes', 'contrast', 'defaultTemplateId', 'isActive']),
        ...(d.bodyPart !== undefined ? { bodyPart: blank(d.bodyPart) } : {}),
        ...(d.serviceCode !== undefined ? { serviceCode: blank(d.serviceCode) } : {}),
        ...(d.preparation !== undefined ? { preparation: blank(d.preparation) } : {}),
        ...(d.price !== undefined ? { price: d.price.toFixed(2) } : {}),
        ...(d.taxRate !== undefined ? { taxRate: d.taxRate.toFixed(2) } : {}),
        updatedBy: currentContext()!.userId ?? null,
      });
      if (!row) throw notFound('Radiology test');
      if (!row.serviceCode && row.price === null) throw badRequest('price_required', 'Give a price or a billing service code');
      const r = (await this.repo.test(tx, id))!;
      return toTest(r.test, r.modalityCode, r.modalityName);
    });
  }

  // ---------- templates ----------

  listTemplates(query: radiology.MasterQuery): Promise<ReportTemplate[]> {
    const q = radiology.masterQuerySchema.parse(query);
    return this.tx(async (tx) => (await this.repo.templates(tx, q)).map(toTemplate));
  }

  getTemplate(id: string): Promise<ReportTemplate> {
    return this.tx(async (tx) => {
      const row = await this.repo.template(tx, id);
      if (!row) throw notFound('Template');
      return toTemplate(row);
    });
  }

  createTemplate(input: radiology.TemplateInput): Promise<ReportTemplate> {
    const d = radiology.templateInputSchema.parse(input);
    const ctx = currentContext()!;
    return this.tx(async (tx) =>
      toTemplate(
        await this.repo.insertTemplate(tx, {
          tenantId: ctx.tenantId!,
          name: d.name,
          modalityId: d.modalityId ?? null,
          technique: blank(d.technique),
          findings: blank(d.findings),
          impression: blank(d.impression),
          isActive: d.isActive,
          createdBy: ctx.userId ?? null,
          updatedBy: ctx.userId ?? null,
        }),
      ),
    );
  }

  updateTemplate(id: string, input: radiology.UpdateTemplate): Promise<ReportTemplate> {
    const d = radiology.updateTemplateSchema.parse(input);
    return this.tx(async (tx) => {
      const row = await this.repo.updateTemplate(tx, id, {
        ...pick(d, ['name', 'modalityId', 'isActive']),
        ...(d.technique !== undefined ? { technique: blank(d.technique) } : {}),
        ...(d.findings !== undefined ? { findings: blank(d.findings) } : {}),
        ...(d.impression !== undefined ? { impression: blank(d.impression) } : {}),
        updatedBy: currentContext()!.userId ?? null,
      });
      if (!row) throw notFound('Template');
      return toTemplate(row);
    });
  }

  /**
   * Loads a starter list of machines, common tests with typical prices and normal-report templates.
   * Skips anything whose code/name already exists, so it is safe to run twice.
   */
  loadStarterMasters(): Promise<{ modalities: number; tests: number; templates: number }> {
    const ctx = currentContext()!;
    const by = { createdBy: ctx.userId ?? null, updatedBy: ctx.userId ?? null };
    return this.tx(async (tx) => {
      const counts = { modalities: 0, tests: 0, templates: 0 };
      const existing = await this.repo.modalities(tx, true);
      const modalityByCode = new Map(existing.map((m) => [m.code, m.id]));
      for (const m of radiology.STARTER_MODALITIES) {
        if (modalityByCode.has(m.code)) continue;
        const row = await this.repo.insertModality(tx, { tenantId: ctx.tenantId!, ...m, ...by });
        modalityByCode.set(m.code, row.id);
        counts.modalities++;
      }
      const templates = await this.repo.templates(tx, { includeInactive: true });
      const templateByName = new Map(templates.map((t) => [t.name.toLowerCase(), t.id]));
      const templateForModality = new Map<string, string>();
      for (const t of radiology.STARTER_TEMPLATES) {
        let id = templateByName.get(t.name.toLowerCase());
        if (!id) {
          id = (
            await this.repo.insertTemplate(tx, {
              tenantId: ctx.tenantId!,
              name: t.name,
              modalityId: t.modality ? (modalityByCode.get(t.modality) ?? null) : null,
              technique: t.technique,
              findings: t.findings,
              impression: t.impression,
              ...by,
            })
          ).id;
          counts.templates++;
        }
        if (t.modality && !templateForModality.has(t.modality)) templateForModality.set(t.modality, id);
      }
      const tests = await this.repo.tests(tx, { includeInactive: true });
      const testCodes = new Set(tests.map((t) => t.test.code));
      for (const t of radiology.STARTER_TESTS) {
        if (testCodes.has(t.code)) continue;
        await this.repo.insertTest(tx, {
          tenantId: ctx.tenantId!,
          code: t.code,
          name: t.name,
          modalityId: modalityByCode.get(t.modality)!,
          bodyPart: t.bodyPart ?? null,
          price: t.price.toFixed(2),
          durationMinutes: t.durationMinutes,
          contrast: t.contrast ?? false,
          preparation: t.preparation ?? null,
          // Only the plain studies get a "normal" template; contrast studies vary too much.
          defaultTemplateId: t.contrast ? null : (templateForModality.get(t.modality) ?? null),
          ...by,
        });
        counts.tests++;
      }
      return counts;
    });
  }

  // ---------- orders ----------

  /** Takes the parsed query (the controller's ZodPipe already parsed it). */
  async listOrders(q: z.output<typeof radiology.orderQuerySchema>): Promise<Paginated<RadiologyOrder>> {
    return this.tx(async (tx) => {
      const { items, total } = await this.repo.searchOrders(tx, q);
      return { items: await this.orderDtos(tx, items), page: q.page, pageSize: q.pageSize, total };
    });
  }

  getOrder(id: string): Promise<radiology.OrderWithReports> {
    return this.tx(async (tx) => {
      const row = await this.repo.order(tx, id);
      if (!row) throw notFound('Radiology order');
      await this.audit.recordView(tx, 'radiology_order', id);
      const reports = await this.repo.reports(tx, id);
      const names = await this.repo.userNames(tx, reports.flatMap((r) => [r.authorId, r.finalizedBy]));
      const [order] = await this.orderDtos(tx, [row]);
      return { order: order!, reports: reports.map((r) => toReport(r, names)) };
    });
  }

  async createOrder(input: radiology.CreateOrder): Promise<RadiologyOrder> {
    const d = radiology.createOrderSchema.parse(input);
    const ctx = currentContext()!;
    const facilityId = ctx.facilityId ?? d.facilityId;
    if (!facilityId) throw badRequest('facility_required', 'Pick the facility you are working in');
    const patient = await this.patients.get(d.patientId);
    return this.tx(async (tx) => {
      const t = await this.repo.test(tx, d.testId);
      if (!t || !t.test.isActive) throw badRequest('invalid_test', 'Pick an active radiology test');
      const names = d.referringDoctorId ? await this.repo.userNames(tx, [d.referringDoctorId]) : new Map<string, string>();
      if (d.referringDoctorId && !names.has(d.referringDoctorId)) throw badRequest('invalid_doctor', 'Referring doctor not found');
      const row = await this.repo.insertOrder(tx, {
        tenantId: ctx.tenantId!,
        orderNo: formatSeries('RAD', await nextCounter(tx, 'radiology.order')),
        facilityId,
        ...patientSnapshot({
          id: patient.id,
          uhid: patient.uhid,
          name: [patient.firstName, patient.lastName].filter(Boolean).join(' '),
          gender: patient.gender,
          dateOfBirth: patient.dateOfBirth,
          mobile: patient.mobile,
        }),
        ...testSnapshot(t.test),
        priority: d.priority,
        source: 'desk',
        referringDoctorId: d.referringDoctorId ?? null,
        referringDoctorName: d.referringDoctorId ? names.get(d.referringDoctorId)! : blank(d.referringDoctorName),
        clinicalNotes: blank(d.clinicalNotes),
        createdBy: ctx.userId ?? null,
        updatedBy: ctx.userId ?? null,
      });
      await this.publishStatus(tx, row);
      return (await this.orderDtos(tx, [row]))[0]!;
    });
  }

  updateOrder(id: string, input: radiology.UpdateOrder): Promise<RadiologyOrder> {
    const d = radiology.updateOrderSchema.parse(input);
    return this.mutateOrder(id, EDITABLE, 'This order can no longer be changed', async (tx, o) => {
      const values: Partial<NewOrderRow> = {};
      if (d.priority !== undefined) values.priority = d.priority;
      if (d.clinicalNotes !== undefined) values.clinicalNotes = blank(d.clinicalNotes);
      if (d.referringDoctorName !== undefined && !o.referringDoctorId) values.referringDoctorName = blank(d.referringDoctorName);
      if (d.testId !== undefined && d.testId !== o.testId) {
        if (o.invoiceId) throw conflict('order_billed', 'This order is already billed. Cancel it and create a new one to change the test.');
        const t = await this.repo.test(tx, d.testId);
        if (!t || !t.test.isActive) throw badRequest('invalid_test', 'Pick an active radiology test');
        Object.assign(values, testSnapshot(t.test));
        // A different study needs a different slot length (and maybe a different machine): book again.
        if (o.status === 'scheduled') Object.assign(values, { status: 'ordered', scheduledAt: null, scheduledEnd: null });
      }
      return values;
    });
  }

  schedule(id: string, input: radiology.ScheduleOrder): Promise<RadiologyOrder> {
    const d = radiology.scheduleOrderSchema.parse(input);
    return this.mutateOrder(id, ['ordered', 'scheduled'], 'Only ordered or scheduled studies can be booked', async (tx, o) => {
      if (!o.testId) throw badRequest('test_required', 'Pick the radiology test before booking a slot');
      const t = await this.repo.test(tx, o.testId);
      const modalityId = d.modalityId ?? o.modalityId ?? t!.test.modalityId;
      // Lock the machine so two desks cannot book the same slot at once.
      const modality = await this.repo.modality(tx, modalityId, true);
      if (!modality || !modality.isActive) throw badRequest('invalid_modality', 'Pick an active machine');
      const start = new Date(d.scheduledAt);
      const end = new Date(start.getTime() + t!.test.durationMinutes * 60_000);
      const [clash] = await this.repo.overlapping(tx, modalityId, start.toISOString(), end.toISOString(), o.id);
      if (clash) throw conflict('slot_taken', `${modality.name} is already booked then (${clash.orderNo})`);
      return { status: 'scheduled', modalityId, scheduledAt: start.toISOString(), scheduledEnd: end.toISOString() };
    });
  }

  start(id: string): Promise<RadiologyOrder> {
    return this.mutateOrder(id, STARTABLE, 'Only ordered or scheduled studies can be started', async (_tx, o) => {
      if (!o.testId) throw badRequest('test_required', 'Pick the radiology test before starting the scan');
      return { status: 'in_progress', startedAt: new Date().toISOString(), performedBy: currentContext()!.userId ?? null };
    });
  }

  completeScan(id: string, input: radiology.CompleteScan): Promise<RadiologyOrder> {
    const d = radiology.completeScanSchema.parse(input);
    return this.mutateOrder(id, COMPLETABLE, 'This study is not waiting for a scan', async (_tx, o) => {
      if (!o.testId) throw badRequest('test_required', 'Pick the radiology test first');
      const now = new Date().toISOString();
      return {
        status: 'acquired',
        startedAt: o.startedAt ?? now,
        acquiredAt: now,
        performedBy: o.performedBy ?? currentContext()!.userId ?? null,
        studyUid: blank(d.studyUid),
        imagesUrl: blank(d.imagesUrl),
        techNotes: blank(d.techNotes),
      };
    });
  }

  cancel(id: string, input: radiology.CancelOrder): Promise<RadiologyOrder> {
    const d = radiology.cancelOrderSchema.parse(input);
    return this.mutateOrder(
      id,
      ['ordered', 'scheduled', 'in_progress', 'acquired', 'reported'],
      'A study with a finalized report cannot be cancelled',
      async () => ({ status: 'cancelled', cancelReason: d.reason, cancelledAt: new Date().toISOString() }),
    );
  }

  /** Raises the bill through BillingService (finalized, optionally paid). One bill per order. */
  bill(id: string, input: radiology.BillOrder): Promise<RadiologyOrder> {
    const d = radiology.billOrderSchema.parse(input);
    const ctx = currentContext()!;
    if (d.payNow && !ctx.permissions.has('billing.payment.collect')) throw forbidden('You cannot collect payments');
    return this.tx(async (tx) => {
      const o = await this.repo.order(tx, id, true);
      if (!o) throw notFound('Radiology order');
      if (o.status === 'cancelled') throw conflict('order_cancelled', 'This order was cancelled');
      if (o.invoiceId) throw conflict('order_billed', `Already billed on ${o.invoiceNo ?? 'a bill'}`);
      if (!o.testId) throw badRequest('test_required', 'Pick the radiology test before billing');
      const t = (await this.repo.test(tx, o.testId))!.test;
      const line = t.serviceCode
        ? { serviceCode: t.serviceCode, qty: 1, description: o.studyName }
        : { description: o.studyName, unitPrice: Number(t.price ?? 0), taxRate: Number(t.taxRate), qty: 1 };
      if (!t.serviceCode && t.price === null) throw badRequest('price_required', 'This test has no price. Set one in the test master.');
      const created = await this.billing.createInvoice(tx, {
        patientId: o.patientId,
        facilityId: o.facilityId,
        source: { module: 'radiology', refId: o.id },
        doctorId: o.referringDoctorId ?? undefined,
        lines: [line],
        payNow: d.payNow,
      });
      const row = await this.repo.updateOrder(tx, o.id, { invoiceId: created.invoiceId, invoiceNo: created.number, updatedBy: ctx.userId ?? null });
      return (await this.orderDtos(tx, [row]))[0]!;
    });
  }

  scheduleFor(query: radiology.ScheduleQuery): Promise<radiology.ScheduleEntry[]> {
    const q = radiology.scheduleQuerySchema.parse(query);
    return this.tx(async (tx) =>
      (await this.repo.schedule(tx, q.date, q.modalityId)).map((o) => ({
        orderId: o.id,
        orderNo: o.orderNo,
        modalityId: o.modalityId!,
        patientName: o.patientName,
        uhid: o.patientUhid,
        studyName: o.studyName,
        status: o.status as OrderStatus,
        priority: o.priority as radiology.OrderPriority,
        scheduledAt: iso(o.scheduledAt!),
        scheduledEnd: iso(o.scheduledEnd!),
      })),
    );
  }

  /**
   * Handler for emr.encounter.signed: turns the consultation's radiology order lines into worklist
   * orders. Idempotent per EMR order line. Lines that match no test in the master are still created
   * (with the doctor's wording) so the desk can pick the test.
   */
  async importFromEncounter(e: EncounterSigned): Promise<number> {
    // An event for a consultation that no longer exists (or never did) has nothing to import.
    const enc = await this.emr.get(e.encounterId, false).catch((err: { getStatus?: () => number }) => {
      if (err?.getStatus?.() === 404) return null;
      throw err;
    });
    if (!enc) return 0;
    const lines = enc.orders.filter((o) => o.kind === 'radiology' && o.status !== 'cancelled');
    if (!lines.length) return 0;
    const ctx = currentContext()!;
    return this.tx(async (tx) => {
      let created = 0;
      for (const line of lines) {
        if (await this.repo.orderByEmrOrder(tx, line.id)) continue;
        const test = await this.repo.matchTest(tx, line.code, line.name);
        const row = await this.repo.insertOrderOnce(tx, {
          tenantId: ctx.tenantId!,
          orderNo: formatSeries('RAD', await nextCounter(tx, 'radiology.order')),
          facilityId: enc.facilityId,
          ...patientSnapshot(enc.patient),
          ...(test ? testSnapshot(test) : { testId: null, testCode: line.code, studyName: line.name, modalityId: null }),
          priority: line.priority === 'urgent' ? 'urgent' : 'routine',
          source: 'emr',
          encounterId: enc.id,
          emrOrderId: line.id,
          referringDoctorId: enc.doctorId,
          referringDoctorName: enc.doctorName,
          clinicalNotes: line.notes,
        });
        if (row) {
          created++;
          await this.publishStatus(tx, row);
        }
      }
      if (created) this.logger.log(`imported ${created} radiology order(s) from encounter ${enc.encounterNo}`);
      return created;
    });
  }

  // ---------- reports ----------

  /** Save (create or update) the working draft. Moves the order to `reported`. */
  saveReport(orderId: string, input: radiology.SaveReport): Promise<radiology.OrderWithReports> {
    const d = radiology.saveReportSchema.parse(input);
    const ctx = currentContext()!;
    return this.withOrder(orderId, async (tx, o) => {
      const reports = await this.repo.reports(tx, o.id);
      const draft = reports.find((r) => r.status === 'draft');
      if (!draft && !REPORTABLE.includes(o.status as OrderStatus)) {
        if (o.status === 'finalized') throw conflict('report_finalized', 'This report is finalized. Amend it to make changes.');
        throw conflict('order_not_ready', 'Mark the scan as done before writing the report');
      }
      if (d.templateId && !(await this.repo.template(tx, d.templateId))) throw badRequest('invalid_template', 'Template not found');
      const content = {
        templateId: d.templateId ?? draft?.templateId ?? null,
        technique: blank(d.technique),
        findings: d.findings,
        impression: d.impression,
        isCritical: d.isCritical,
      };
      if (draft) await this.repo.updateReport(tx, draft.id, { ...content, authorId: ctx.userId ?? draft.authorId });
      else await this.repo.insertReport(tx, { tenantId: ctx.tenantId!, orderId: o.id, version: 1, ...content, authorId: ctx.userId ?? null });
      if (o.status !== 'reported' && o.status !== 'finalized') {
        const row = await this.repo.updateOrder(tx, o.id, {
          status: 'reported',
          acquiredAt: o.acquiredAt ?? new Date().toISOString(),
          updatedBy: ctx.userId ?? null,
        });
        await this.publishStatus(tx, row);
      }
    });
  }

  /** Sign the draft. Supersedes the earlier final version (amendment) and tells the portal. */
  finalizeReport(orderId: string): Promise<radiology.OrderWithReports> {
    const ctx = currentContext()!;
    return this.withOrder(orderId, async (tx, o) => {
      const reports = await this.repo.reports(tx, o.id);
      const draft = reports.find((r) => r.status === 'draft');
      if (!draft) throw conflict('no_draft', 'There is no draft report to finalize');
      const previous = reports.find((r) => r.status === 'final');
      if (previous) await this.repo.updateReport(tx, previous.id, { status: 'superseded' });
      const now = new Date().toISOString();
      const report = await this.repo.updateReport(tx, draft.id, { status: 'final', finalizedAt: now, finalizedBy: ctx.userId! });
      const row = await this.repo.updateOrder(tx, o.id, { status: 'finalized', updatedBy: ctx.userId ?? null });
      if (o.status !== 'finalized') await this.publishStatus(tx, row);
      const event: radiology.ReportFinalizedEvent = {
        reportId: report.id,
        patientId: o.patientId,
        title: report.version > 1 ? `${o.studyName} (amended)` : o.studyName,
        issuedAt: now,
        orderId: o.id,
        version: report.version,
        isCritical: report.isCritical,
        referringDoctorId: o.referringDoctorId,
        facilityId: o.facilityId,
      };
      await this.outbox.publish(tx, 'radiology.report.finalized', { ...event });
      if (report.isCritical) {
        const critical: radiology.CriticalFindingEvent = {
          reportId: report.id,
          orderId: o.id,
          patientId: o.patientId,
          referringDoctorId: o.referringDoctorId,
          studyName: o.studyName,
          impression: report.impression,
        };
        await this.outbox.publish(tx, 'radiology.report.critical', { ...critical });
      }
    });
  }

  /** Open a new draft version from the current final report. The final stays valid until the amendment is signed. */
  amendReport(orderId: string, input: radiology.AmendReport): Promise<radiology.OrderWithReports> {
    const d = radiology.amendReportSchema.parse(input);
    const ctx = currentContext()!;
    return this.withOrder(orderId, async (tx, o) => {
      const reports = await this.repo.reports(tx, o.id);
      if (reports.some((r) => r.status === 'draft')) throw conflict('draft_exists', 'An amendment draft is already open');
      const final = reports.find((r) => r.status === 'final');
      if (!final) throw conflict('not_finalized', 'Only a finalized report can be amended');
      await this.repo.insertReport(tx, {
        tenantId: ctx.tenantId!,
        orderId: o.id,
        version: Math.max(...reports.map((r) => r.version)) + 1,
        templateId: final.templateId,
        technique: final.technique,
        findings: final.findings,
        impression: final.impression,
        isCritical: final.isCritical,
        amendmentReason: d.reason,
        authorId: ctx.userId ?? null,
      });
    });
  }

  /** Discard an unsigned draft (e.g. an amendment started by mistake). */
  discardDraft(orderId: string): Promise<radiology.OrderWithReports> {
    return this.withOrder(orderId, async (tx, o) => {
      const reports = await this.repo.reports(tx, o.id);
      const draft = reports.find((r) => r.status === 'draft');
      if (!draft) throw conflict('no_draft', 'There is no draft report');
      await this.repo.deleteDraft(tx, draft.id);
      if (!reports.some((r) => r.status === 'final') && o.status === 'reported') {
        const row = await this.repo.updateOrder(tx, o.id, { status: 'acquired', updatedBy: currentContext()!.userId ?? null });
        await this.publishStatus(tx, row);
      }
    });
  }

  /** One report version with its order, for viewing and printing. */
  getReport(reportId: string): Promise<radiology.ReportDocument> {
    return this.tx(async (tx) => {
      const report = await this.repo.report(tx, reportId);
      if (!report) throw notFound('Radiology report');
      const order = (await this.repo.order(tx, report.orderId))!;
      await this.audit.recordView(tx, 'radiology_report', reportId);
      const all = await this.repo.reports(tx, order.id);
      const names = await this.repo.userNames(tx, all.flatMap((r) => [r.authorId, r.finalizedBy]));
      const [orderDto] = await this.orderDtos(tx, [order]);
      return {
        report: toReport(report, names),
        order: orderDto!,
        history: all
          .filter((r) => r.id !== report.id)
          .map((r) => {
            const dto = toReport(r, names);
            return pick(dto, ['id', 'version', 'status', 'finalizedAt', 'finalizedByName', 'amendmentReason']) as radiology.ReportDocument['history'][number];
          }),
      };
    });
  }

  // ---------- helpers ----------

  private withOrder(orderId: string, fn: (tx: Tx, o: OrderRow) => Promise<void>): Promise<radiology.OrderWithReports> {
    return this.tx(async (tx) => {
      const o = await this.repo.order(tx, orderId, true);
      if (!o) throw notFound('Radiology order');
      if (o.status === 'cancelled') throw conflict('order_cancelled', 'This order was cancelled');
      await fn(tx, o);
    }).then(() => this.getOrder(orderId));
  }

  private mutateOrder(
    id: string,
    from: OrderStatus[],
    message: string,
    fn: (tx: Tx, o: OrderRow) => Promise<Partial<NewOrderRow>>,
  ): Promise<RadiologyOrder> {
    return this.tx(async (tx) => {
      const o = await this.repo.order(tx, id, true);
      if (!o) throw notFound('Radiology order');
      if (!from.includes(o.status as OrderStatus)) {
        if (o.status === 'cancelled') throw conflict('order_cancelled', 'This order was cancelled');
        throw conflict('invalid_status', message);
      }
      const values = await fn(tx, o);
      const row = await this.repo.updateOrder(tx, id, { ...values, updatedBy: currentContext()!.userId ?? null });
      if (row.status !== o.status) await this.publishStatus(tx, row);
      return (await this.orderDtos(tx, [row]))[0]!;
    });
  }

  private async publishStatus(tx: Tx, o: OrderRow): Promise<void> {
    const event: radiology.OrderStatusChangedEvent = {
      orderId: o.id,
      emrOrderId: o.emrOrderId,
      encounterId: o.encounterId,
      patientId: o.patientId,
      status: o.status as OrderStatus,
    };
    await this.outbox.publish(tx, 'radiology.order.status_changed', { ...event });
  }

  private async orderDtos(tx: Tx, rows: OrderRow[]): Promise<RadiologyOrder[]> {
    const [modalities, finals] = await Promise.all([this.repo.modalities(tx, true), this.repo.finalReportIds(tx, rows.map((r) => r.id))]);
    const modalityName = new Map(modalities.map((m) => [m.id, m.name]));
    return rows.map((r) => toOrder(r, r.modalityId ? (modalityName.get(r.modalityId) ?? null) : null, finals.get(r.id) ?? null));
  }
}

// ---------- mapping ----------

function patientSnapshot(p: { id: string; uhid: string; name: string; gender: string; dateOfBirth: string | null; mobile: string | null }) {
  return {
    patientId: p.id,
    patientName: p.name,
    patientUhid: p.uhid,
    patientGender: p.gender,
    patientDob: p.dateOfBirth,
    patientMobile: p.mobile,
  };
}

function testSnapshot(t: TestRow) {
  return { testId: t.id, testCode: t.code, studyName: t.name, modalityId: t.modalityId };
}

function ageYears(dob: string | null): number | null {
  if (!dob) return null;
  const b = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age--;
  return age;
}

function toModality(r: ModalityRow): Modality {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    kind: r.kind as Modality['kind'],
    facilityId: r.facilityId,
    room: r.room,
    aeTitle: r.aeTitle,
    isActive: r.isActive,
  };
}

function toTest(r: TestRow, modalityCode: string, modalityName: string): RadiologyTest {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    modalityId: r.modalityId,
    modalityCode,
    modalityName,
    bodyPart: r.bodyPart,
    serviceCode: r.serviceCode,
    price: num(r.price),
    taxRate: Number(r.taxRate),
    durationMinutes: r.durationMinutes,
    contrast: r.contrast,
    preparation: r.preparation,
    defaultTemplateId: r.defaultTemplateId,
    isActive: r.isActive,
  };
}

function toTemplate(r: TemplateRow): ReportTemplate {
  return {
    id: r.id,
    name: r.name,
    modalityId: r.modalityId,
    technique: r.technique,
    findings: r.findings,
    impression: r.impression,
    isActive: r.isActive,
  };
}

function toOrder(r: OrderRow, modalityName: string | null, finalReportId: string | null): RadiologyOrder {
  return {
    id: r.id,
    orderNo: r.orderNo,
    facilityId: r.facilityId,
    patient: {
      id: r.patientId,
      uhid: r.patientUhid,
      name: r.patientName,
      gender: r.patientGender,
      ageYears: ageYears(r.patientDob),
      mobile: r.patientMobile,
    },
    testId: r.testId,
    testCode: r.testCode,
    studyName: r.studyName,
    modalityId: r.modalityId,
    modalityName,
    priority: r.priority as RadiologyOrder['priority'],
    status: r.status as OrderStatus,
    source: r.source as RadiologyOrder['source'],
    encounterId: r.encounterId,
    emrOrderId: r.emrOrderId,
    referringDoctorId: r.referringDoctorId,
    referringDoctorName: r.referringDoctorName,
    clinicalNotes: r.clinicalNotes,
    scheduledAt: iso(r.scheduledAt),
    scheduledEnd: iso(r.scheduledEnd),
    startedAt: iso(r.startedAt),
    acquiredAt: iso(r.acquiredAt),
    studyUid: r.studyUid,
    imagesUrl: r.imagesUrl,
    techNotes: r.techNotes,
    invoiceId: r.invoiceId,
    invoiceNo: r.invoiceNo,
    cancelReason: r.cancelReason,
    finalReportId,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function toReport(r: ReportRow, names: Map<string, string>): RadiologyReport {
  return {
    id: r.id,
    orderId: r.orderId,
    version: r.version,
    status: r.status as RadiologyReport['status'],
    templateId: r.templateId,
    technique: r.technique,
    findings: r.findings,
    impression: r.impression,
    isCritical: r.isCritical,
    amendmentReason: r.amendmentReason,
    authorId: r.authorId,
    authorName: r.authorId ? (names.get(r.authorId) ?? null) : null,
    finalizedAt: iso(r.finalizedAt),
    finalizedBy: r.finalizedBy,
    finalizedByName: r.finalizedBy ? (names.get(r.finalizedBy) ?? null) : null,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function pick<T extends object, K extends keyof T>(o: T, keys: K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

function hasHint(e: unknown, hint: string): boolean {
  for (let cur = e as { hint?: string; cause?: unknown } | undefined; cur; cur = cur.cause as typeof cur) {
    if (cur.hint === hint) return true;
  }
  return false;
}

function pgCode(e: unknown): { code: string; constraint?: string } | undefined {
  for (let cur = e as { code?: string; constraint?: string; cause?: unknown } | undefined; cur; cur = cur.cause as typeof cur) {
    if (typeof cur.code === 'string' && /^\d{5}$/.test(cur.code)) return { code: cur.code, constraint: cur.constraint };
  }
  return undefined;
}
