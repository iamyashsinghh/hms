import { Injectable } from '@nestjs/common';
import { iso, type Tx } from '@hms/db';
import { lab, type Paginated, type Patient } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { AuditService } from '../../common/db/audit.service';
import { OutboxService } from '../../common/events/outbox.service';
import { currentContext } from '../../common/context/request-context';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { BillingService } from '../billing/billing.service';
import { EmrService } from '../emr/emr.service';
import { PatientsService } from '../patients/patients.service';
import { SetupService } from '../setup/setup.service';
import {
  LabRepository,
  type ItemRow,
  type NewItemRow,
  type NewResultRow,
  type OrderRow,
  type PanelRow,
  type RangeRow,
  type ResultRow,
  type SampleRow,
  type TestRow,
} from './lab.repository';
import { STARTER_PANELS, STARTER_TESTS } from './starter-catalogue';

type LabTest = lab.LabTest;
type LabPanel = lab.LabPanel;
type Order = lab.Order;
type OrderSummary = lab.OrderSummary;

/** Patient fields the order snapshots (printed on the report). */
type PatientSnapshot = Pick<Patient, 'id' | 'uhid' | 'firstName' | 'lastName' | 'gender' | 'dateOfBirth' | 'mobile'>;

/** One orderable picked for an order, already resolved to catalogue rows. */
interface Picked {
  kind: 'test' | 'panel' | 'unmatched';
  test?: TestRow;
  panel?: PanelRow;
  name: string;
  code: string | null;
  emrOrderId?: string;
}

@Injectable()
export class LabService {
  constructor(
    private readonly db: DbService,
    private readonly repo: LabRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly patients: PatientsService,
    private readonly billing: BillingService,
    private readonly setup: SetupService,
    private readonly emr: EmrService,
  ) {}

  /** Runs a transaction and turns the result lock into a clean 409. */
  private tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.tx(fn).catch((e: unknown) => {
      if (hasHint(e, 'lab_result_locked')) throw conflict('result_verified', 'This result is verified. Amend it to make a correction.');
      if (isUniqueViolation(e, 'lab_tests_code_uq') || isUniqueViolation(e, 'lab_panels_code_uq')) throw conflict('code_taken', 'That code is already used');
      throw e;
    });
  }

  // =====================================================================
  // Catalogue
  // =====================================================================

  listTests(query: unknown): Promise<LabTest[]> {
    const q = lab.catalogueQuerySchema.parse(query);
    return this.tx(async (tx) => {
      const rows = await this.repo.listTests(tx, q);
      return this.testDtos(tx, rows);
    });
  }

  getTest(id: string): Promise<LabTest> {
    return this.tx(async (tx) => {
      const row = await this.repo.testById(tx, id);
      if (!row) throw notFound('Lab test');
      return (await this.testDtos(tx, [row]))[0]!;
    });
  }

  createTest(input: lab.TestInput): Promise<LabTest> {
    const d = lab.testInputSchema.parse(input);
    const ctx = currentContext()!;
    return this.tx(async (tx) => {
      const row = await this.repo.insertTest(tx, { ...testColumns(d), tenantId: ctx.tenantId!, code: d.code, createdBy: ctx.userId, updatedBy: ctx.userId });
      await this.repo.replaceRanges(tx, ctx.tenantId!, row.id, d.ranges.map(rangeColumns));
      return (await this.testDtos(tx, [row]))[0]!;
    });
  }

  updateTest(id: string, input: lab.UpdateTest): Promise<LabTest> {
    const d = lab.updateTestSchema.parse(input);
    const ctx = currentContext()!;
    return this.tx(async (tx) => {
      const row = await this.repo.updateTest(tx, id, { ...testColumns(d), updatedBy: ctx.userId });
      if (!row) throw notFound('Lab test');
      if (d.ranges) await this.repo.replaceRanges(tx, ctx.tenantId!, id, d.ranges.map(rangeColumns));
      return (await this.testDtos(tx, [row]))[0]!;
    });
  }

  listPanels(query: unknown): Promise<LabPanel[]> {
    const q = lab.catalogueQuerySchema.parse(query);
    return this.tx(async (tx) => this.panelDtos(tx, await this.repo.listPanels(tx, q)));
  }

  getPanel(id: string): Promise<LabPanel> {
    return this.tx(async (tx) => {
      const row = await this.repo.panelById(tx, id);
      if (!row) throw notFound('Lab panel');
      return (await this.panelDtos(tx, [row]))[0]!;
    });
  }

  createPanel(input: lab.PanelInput): Promise<LabPanel> {
    const d = lab.panelInputSchema.parse(input);
    const ctx = currentContext()!;
    return this.tx(async (tx) => {
      await this.requireTests(tx, d.testIds);
      const row = await this.repo.insertPanel(tx, {
        tenantId: ctx.tenantId!,
        code: d.code,
        name: d.name,
        price: String(d.price),
        serviceCode: d.serviceCode || null,
        isActive: d.isActive,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      });
      await this.repo.replacePanelTests(tx, ctx.tenantId!, row.id, unique(d.testIds));
      return (await this.panelDtos(tx, [row]))[0]!;
    });
  }

  updatePanel(id: string, input: lab.UpdatePanel): Promise<LabPanel> {
    const d = lab.updatePanelSchema.parse(input);
    const ctx = currentContext()!;
    return this.tx(async (tx) => {
      const row = await this.repo.updatePanel(tx, id, {
        ...(d.name !== undefined && { name: d.name }),
        ...(d.price !== undefined && { price: String(d.price) }),
        ...(d.serviceCode !== undefined && { serviceCode: d.serviceCode || null }),
        ...(d.isActive !== undefined && { isActive: d.isActive }),
        updatedBy: ctx.userId,
      });
      if (!row) throw notFound('Lab panel');
      if (d.testIds) {
        await this.requireTests(tx, d.testIds);
        await this.repo.replacePanelTests(tx, ctx.tenantId!, id, unique(d.testIds));
      }
      return (await this.panelDtos(tx, [row]))[0]!;
    });
  }

  /** Active tests and panels for the order picker. */
  orderables(query: unknown): Promise<lab.Orderable[]> {
    const q = lab.catalogueQuerySchema.parse(query);
    return this.tx(async (tx) => {
      const [tests, panels] = await Promise.all([this.repo.listTests(tx, { ...q, active: 'true' }), this.repo.listPanels(tx, { ...q, active: 'true' })]);
      return [
        ...panels.map((p) => ({ kind: 'panel' as const, id: p.id, code: p.code, name: p.name, price: num(p.price)!, sampleType: null })),
        ...tests.map((t) => ({ kind: 'test' as const, id: t.id, code: t.code, name: t.name, price: num(t.price)!, sampleType: t.sampleType as lab.SampleType })),
      ];
    });
  }

  /** Adds the starter catalogue; codes that already exist are left alone, so it is safe to run twice. */
  loadStarterCatalogue(): Promise<{ testsAdded: number; panelsAdded: number }> {
    const ctx = currentContext()!;
    return this.tx(async (tx) => {
      const tenantId = ctx.tenantId!;
      const existing = new Map((await this.repo.testsByCodes(tx, STARTER_TESTS.map((t) => t.code.toUpperCase()))).map((t) => [t.code, t]));
      let testsAdded = 0;
      for (const raw of STARTER_TESTS) {
        const d = lab.testInputSchema.parse({ ...raw, ranges: raw.ranges ?? [] });
        if (existing.has(d.code)) continue;
        const row = await this.repo.insertTest(tx, { ...testColumns(d), tenantId, code: d.code, createdBy: ctx.userId, updatedBy: ctx.userId });
        await this.repo.replaceRanges(tx, tenantId, row.id, d.ranges.map(rangeColumns));
        existing.set(row.code, row);
        testsAdded++;
      }
      const havePanels = new Set((await this.repo.panelsByCodes(tx, STARTER_PANELS.map((p) => p.code))).map((p) => p.code));
      let panelsAdded = 0;
      for (const p of STARTER_PANELS) {
        if (havePanels.has(p.code)) continue;
        const testIds = p.tests.map((c) => existing.get(c)?.id).filter((x): x is string => !!x);
        if (!testIds.length) continue;
        const row = await this.repo.insertPanel(tx, { tenantId, code: p.code, name: p.name, price: String(p.price), createdBy: ctx.userId, updatedBy: ctx.userId });
        await this.repo.replacePanelTests(tx, tenantId, row.id, testIds);
        panelsAdded++;
      }
      return { testsAdded, panelsAdded };
    });
  }

  // =====================================================================
  // Orders
  // =====================================================================

  listOrders(query: unknown): Promise<Paginated<OrderSummary>> {
    const q = lab.orderQuerySchema.parse(query);
    return this.tx(async (tx) => {
      const { items, total } = await this.repo.searchOrders(tx, q);
      const lines = await this.repo.items(tx, items.map((o) => o.id));
      return { items: items.map((o) => summaryDto(o, lines.filter((l) => l.orderId === o.id))), page: q.page, pageSize: q.pageSize, total };
    });
  }

  getOrder(id: string): Promise<Order> {
    return this.tx(async (tx) => {
      const row = await this.repo.orderById(tx, id);
      if (!row) throw notFound('Lab order');
      await this.audit.recordView(tx, 'lab_order', id);
      return this.orderDto(tx, row);
    });
  }

  /** Walk-in / referral / B2B order booked at the lab counter. Bills straight away unless `bill: false`. */
  async createOrder(input: lab.CreateOrder): Promise<Order> {
    const d = lab.createOrderSchema.parse(input);
    const ctx = currentContext()!;
    if (!ctx.facilityId) throw badRequest('facility_required', 'Pick the facility you are working in');
    if (d.payNow && !d.bill) throw badRequest('bill_required', 'Turn on billing to collect a payment');
    const keys = d.items.map((i) => i.testId ?? i.panelId!);
    if (new Set(keys).size !== keys.length) throw badRequest('duplicate_item', 'The same test or panel is added twice');
    const patient = await this.patients.get(d.patientId);
    return this.tx(async (tx) => {
      const [tests, panels] = await Promise.all([
        this.repo.testsByIds(tx, d.items.flatMap((i) => (i.testId ? [i.testId] : []))),
        this.repo.panelsByIds(tx, d.items.flatMap((i) => (i.panelId ? [i.panelId] : []))),
      ]);
      const picked: Picked[] = d.items.map((i) => {
        const test = i.testId ? tests.find((t) => t.id === i.testId) : undefined;
        const panel = i.panelId ? panels.find((p) => p.id === i.panelId) : undefined;
        const row = test ?? panel;
        if (!row) throw notFound(i.testId ? 'Lab test' : 'Lab panel');
        if (!row.isActive) throw badRequest('inactive_item', `${row.name} is not active`);
        return test ? { kind: 'test', test, name: test.name, code: test.code } : { kind: 'panel', panel: panel!, name: panel!.name, code: panel!.code };
      });
      let doctorName: string | null = null;
      if (d.doctorId) {
        doctorName = (await this.repo.userNames(tx, [d.doctorId])).get(d.doctorId) ?? null;
        if (!doctorName) throw badRequest('doctor_not_found', 'Referring doctor not found');
      }
      const order = await this.insertOrder(tx, {
        facilityId: ctx.facilityId!,
        patient,
        source: d.source,
        priority: d.priority,
        doctorId: d.doctorId ?? null,
        doctorName,
        referredBy: d.referredBy || null,
        clinicalNotes: d.clinicalNotes || null,
        encounterId: null,
        picked,
      });
      const billed = d.bill ? await this.billTx(tx, order, d.payNow) : order;
      await this.publishCreated(tx, billed);
      return this.orderDto(tx, billed);
    });
  }

  /**
   * Handler for `emr.encounter.signed`: turns the consultation's lab order lines into one lab order.
   * Lines are matched to the catalogue by code, then by name; anything unmatched stays on the order
   * for the lab to sort out. Idempotent per consultation.
   */
  async createFromEncounter(encounterId: string): Promise<Order | null> {
    const enc = await this.emr.get(encounterId, false);
    const lines = enc.orders.filter((o) => o.kind === 'lab' && o.status !== 'cancelled');
    if (!lines.length) return null;
    const patient = await this.patients.get(enc.patient.id);
    return this.tx(async (tx) => {
      const existing = await this.repo.orderByEncounter(tx, encounterId);
      if (existing) return this.orderDto(tx, existing);
      const [tests, panels] = await Promise.all([this.repo.listTests(tx, { active: 'true' }), this.repo.listPanels(tx, { active: 'true' })]);
      const byKey = (rows: (TestRow | PanelRow)[]) => {
        const m = new Map<string, TestRow | PanelRow>();
        for (const r of rows) {
          m.set(`code:${r.code}`, r);
          m.set(`name:${r.name.toLowerCase()}`, r);
        }
        return m;
      };
      const panelKeys = byKey(panels);
      const testKeys = byKey(tests);
      const picked: Picked[] = lines.map((l) => {
        const keys = [l.code ? `code:${l.code.trim().toUpperCase()}` : '', `code:${l.name.trim().toUpperCase()}`, `name:${l.name.trim().toLowerCase()}`];
        for (const k of keys) {
          const panel = panelKeys.get(k) as PanelRow | undefined;
          if (panel) return { kind: 'panel', panel, name: panel.name, code: panel.code, emrOrderId: l.id };
          const test = testKeys.get(k) as TestRow | undefined;
          if (test) return { kind: 'test', test, name: test.name, code: test.code, emrOrderId: l.id };
        }
        return { kind: 'unmatched', name: l.name, code: l.code, emrOrderId: l.id };
      });
      const order = await this.insertOrder(tx, {
        facilityId: enc.facilityId,
        patient,
        source: 'emr',
        priority: lines.some((l) => l.priority === 'urgent') ? 'urgent' : 'routine',
        doctorId: enc.doctorId,
        doctorName: enc.doctorName,
        referredBy: null,
        clinicalNotes: lines.map((l) => l.notes).filter(Boolean).join('; ') || null,
        encounterId,
        picked,
      });
      await this.publishCreated(tx, order);
      return this.orderDto(tx, order);
    });
  }

  /** Raise the bill for an order booked without one (e.g. from a consultation). */
  bill(id: string, payNow?: lab.CreateOrder['payNow']): Promise<Order> {
    return this.tx(async (tx) => {
      const order = await this.lockOrder(tx, id);
      if (order.status === 'cancelled') throw conflict('order_cancelled', 'This order is cancelled');
      if (order.invoiceId) throw conflict('already_billed', `Already billed on ${order.invoiceNo}`);
      return this.orderDto(tx, await this.billTx(tx, order, payNow));
    });
  }

  cancel(id: string, input: lab.CancelOrder): Promise<Order> {
    const d = lab.cancelOrderSchema.parse(input);
    const ctx = currentContext()!;
    return this.tx(async (tx) => {
      const order = await this.lockOrder(tx, id);
      if (order.status === 'cancelled') return this.orderDto(tx, order);
      const results = await this.repo.results(tx, [id]);
      if (results.some((r) => r.status === 'verified')) throw conflict('order_reported', 'Results are already verified; this order cannot be cancelled');
      const row = await this.repo.updateOrder(tx, id, { status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledReason: d.reason, updatedBy: ctx.userId });
      await this.outbox.publish(tx, 'lab.order.cancelled', { orderId: id, orderNo: order.orderNo, patientId: order.patientId, invoiceId: order.invoiceId, reason: d.reason });
      return this.orderDto(tx, row);
    });
  }

  // =====================================================================
  // Samples
  // =====================================================================

  worklist(query: unknown): Promise<lab.WorklistSample[]> {
    const q = lab.sampleWorklistQuerySchema.parse(query);
    return this.tx(async (tx) => {
      const rows = await this.repo.worklist(tx, q.status, currentContext()?.facilityId);
      const results = await this.repo.results(tx, [...new Set(rows.map((r) => r.order.id))]);
      return rows.map(({ sample, order }) => ({
        ...sampleDto(sample, results),
        orderId: order.id,
        orderNo: order.orderNo,
        priority: order.priority as lab.OrderPriority,
        patient: patientDto(order),
      }));
    });
  }

  /** Mark every pending sample of the order as collected (the usual one-click at the counter). */
  collectAll(orderId: string): Promise<Order> {
    return this.tx(async (tx) => {
      const order = await this.openOrder(tx, orderId);
      const now = new Date().toISOString();
      for (const s of await this.repo.samples(tx, [orderId])) {
        if (s.status === 'pending') await this.repo.updateSample(tx, s.id, { status: 'collected', collectedAt: now, collectedBy: currentContext()?.userId ?? null });
      }
      return this.orderDto(tx, await this.recompute(tx, order));
    });
  }

  collect(sampleId: string): Promise<Order> {
    return this.sampleStep(sampleId, ['pending'], () => ({ status: 'collected', collectedAt: new Date().toISOString(), collectedBy: currentContext()?.userId ?? null }));
  }

  /** Accession in the lab. A pending sample can be received directly (collected at the lab). */
  receive(sampleId: string): Promise<Order> {
    return this.sampleStep(sampleId, ['pending', 'collected'], (s) => {
      const now = new Date().toISOString();
      const by = currentContext()?.userId ?? null;
      return { status: 'received', receivedAt: now, receivedBy: by, ...(s.collectedAt ? {} : { collectedAt: now, collectedBy: by }) };
    });
  }

  reject(sampleId: string, input: lab.RejectSample): Promise<Order> {
    const d = lab.rejectSampleSchema.parse(input);
    return this.sampleStep(sampleId, ['pending', 'collected', 'received'], () => ({ status: 'rejected', rejectedReason: d.reason }));
  }

  /** New sample (new barcode) for a rejected one; its pending results move to the new sample. */
  recollect(sampleId: string): Promise<Order> {
    return this.tx(async (tx) => {
      const sample = await this.repo.sampleById(tx, sampleId);
      if (!sample) throw notFound('Sample');
      const order = await this.openOrder(tx, sample.orderId);
      if (sample.status !== 'rejected') throw conflict('sample_not_rejected', 'Only a rejected sample can be recollected');
      const moving = (await this.repo.results(tx, [order.id])).filter((r) => r.sampleId === sampleId && r.status !== 'verified');
      if (!moving.length) throw conflict('already_recollected', `Sample ${sample.barcode} has already been recollected`);
      const [fresh] = await this.repo.insertSamples(tx, [
        { tenantId: order.tenantId, orderId: order.id, barcode: await this.nextBarcode(tx), sampleType: sample.sampleType, container: sample.container },
      ]);
      for (const r of moving) await this.repo.updateResult(tx, r.id, { sampleId: fresh!.id });
      return this.orderDto(tx, await this.recompute(tx, order));
    });
  }

  private sampleStep(sampleId: string, from: lab.SampleStatus[], values: (s: SampleRow) => Partial<SampleRow>): Promise<Order> {
    return this.tx(async (tx) => {
      const sample = await this.repo.sampleById(tx, sampleId);
      if (!sample) throw notFound('Sample');
      const order = await this.openOrder(tx, sample.orderId);
      if (!from.includes(sample.status as lab.SampleStatus)) throw conflict('sample_status', `Sample ${sample.barcode} is ${sample.status}`);
      await this.repo.updateSample(tx, sampleId, values(sample));
      return this.orderDto(tx, await this.recompute(tx, order));
    });
  }

  // =====================================================================
  // Results
  // =====================================================================

  enterResults(orderId: string, input: lab.EnterResults): Promise<Order> {
    const d = lab.enterResultsSchema.parse(input);
    const ctx = currentContext()!;
    return this.tx(async (tx) => {
      const order = await this.openOrder(tx, orderId);
      const [results, samples] = await Promise.all([this.repo.results(tx, [orderId]), this.repo.samples(tx, [orderId])]);
      const now = new Date().toISOString();
      for (const e of d.results) {
        const r = results.find((x) => x.id === e.resultId);
        if (!r) throw notFound('Result');
        if (r.status === 'verified') throw conflict('result_verified', `${r.name} is verified. Amend it to make a correction.`);
        const sample = samples.find((s) => s.id === r.sampleId);
        if (!sample || sample.status === 'pending' || sample.status === 'rejected') {
          throw conflict('sample_not_collected', `Collect the ${sample?.sampleType ?? ''} sample for ${r.name} first`.replace('  ', ' '));
        }
        const value = e.value.trim();
        const dto = resultDto(r);
        if (value && r.resultType === 'numeric' && !Number.isFinite(Number(value.replace(/^[<>]=?\s*/, '')))) {
          throw badRequest('invalid_value', `${r.name}: enter a number`);
        }
        if (value && r.resultType === 'option' && r.options.length && !r.options.includes(value)) {
          throw badRequest('invalid_value', `${r.name}: pick one of ${r.options.join(', ')}`);
        }
        const flag = value ? lab.flagFor(dto, value) : null;
        const updated = await this.repo.updateResult(tx, r.id, {
          value: value || null,
          valueNum: value && r.resultType === 'numeric' ? String(Number(value.replace(/^[<>]=?\s*/, ''))) : null,
          flag,
          remarks: e.remarks || null,
          status: value ? 'entered' : 'pending',
          enteredAt: value ? now : null,
          enteredBy: value ? (ctx.userId ?? null) : null,
        });
        if ((flag === 'critical_low' || flag === 'critical_high') && (r.flag !== flag || r.value !== value)) {
          const event: lab.ResultCriticalEvent = {
            orderId,
            orderNo: order.orderNo,
            resultId: r.id,
            patientId: order.patientId,
            doctorId: order.doctorId,
            testName: r.name,
            value,
            unit: r.unit,
            flag,
          };
          await this.outbox.publish(tx, 'lab.result.critical', { ...event });
          await this.repo.updateOrder(tx, orderId, { hasCritical: true });
        }
        Object.assign(r, updated);
      }
      return this.orderDto(tx, await this.recompute(tx, order));
    });
  }

  /** Verify entered results. When every result is verified the report is released (`lab.report.verified`). */
  verify(orderId: string, input: lab.Verify): Promise<Order> {
    const d = lab.verifySchema.parse(input);
    const ctx = currentContext()!;
    return this.tx(async (tx) => {
      const order = await this.openOrder(tx, orderId);
      const results = await this.repo.results(tx, [orderId]);
      const targets = d.resultIds ? results.filter((r) => d.resultIds!.includes(r.id)) : results.filter((r) => r.status === 'entered');
      if (d.resultIds && targets.length !== d.resultIds.length) throw notFound('Result');
      if (!targets.length) throw badRequest('nothing_to_verify', 'Enter results before verifying');
      const notReady = targets.find((r) => r.status !== 'entered');
      if (notReady) throw conflict('result_not_entered', `${notReady.name} has no result to verify`);
      const now = new Date().toISOString();
      for (const r of targets) await this.repo.updateResult(tx, r.id, { status: 'verified', verifiedAt: now, verifiedBy: ctx.userId ?? null });
      const after = await this.recompute(tx, order, { verifiedAt: now, verifiedBy: ctx.userId ?? null });
      if (after.status === 'completed') await this.publishReport(tx, after);
      return this.orderDto(tx, after);
    });
  }

  /** Reopen a verified result for correction. The reason is kept and the report must be verified again. */
  amend(orderId: string, input: lab.Amend): Promise<Order> {
    const d = lab.amendSchema.parse(input);
    return this.tx(async (tx) => {
      const order = await this.lockOrder(tx, orderId);
      if (order.status === 'cancelled') throw conflict('order_cancelled', 'This order is cancelled');
      const [r] = (await this.repo.results(tx, [orderId])).filter((x) => x.id === d.resultId);
      if (!r) throw notFound('Result');
      if (r.status !== 'verified') throw conflict('result_not_verified', `${r.name} is not verified; edit it directly`);
      await this.repo.updateResult(tx, r.id, { status: 'entered', verifiedAt: null, verifiedBy: null, amendCount: r.amendCount + 1, lastAmendReason: d.reason });
      return this.orderDto(tx, await this.recompute(tx, order));
    });
  }

  /** Data for the printable report (provisional until every result is verified). */
  report(id: string): Promise<lab.Report> {
    return this.tx(async (tx) => {
      const row = await this.repo.orderById(tx, id);
      if (!row) throw notFound('Lab order');
      await this.audit.recordView(tx, 'lab_report', id);
      const [order, profile] = await Promise.all([this.orderDto(tx, row), this.setup.getProfileInTx(tx).catch(() => null)]);
      const a = profile?.address;
      return {
        order,
        hospital: {
          name: profile?.displayName || profile?.legalName || 'Hospital',
          address: a ? [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(', ') || null : null,
          phone: profile?.phone ?? null,
          email: profile?.email ?? null,
          registrationNo: profile?.registrationNo ?? null,
          accreditation: profile?.accreditation ?? null,
          logoUrl: profile?.logoUrl ?? null,
          footerNote: profile?.letterhead?.footerNote ?? null,
        },
      };
    });
  }

  // =====================================================================
  // Internals
  // =====================================================================

  private async insertOrder(
    tx: Tx,
    o: {
      facilityId: string;
      patient: PatientSnapshot;
      source: lab.OrderSource;
      priority: lab.OrderPriority;
      doctorId: string | null;
      doctorName: string | null;
      referredBy: string | null;
      clinicalNotes: string | null;
      encounterId: string | null;
      picked: Picked[];
    },
  ): Promise<OrderRow> {
    const ctx = currentContext();
    const tenantId = ctx?.tenantId;
    if (!tenantId) throw new Error('lab order without tenant');
    const p = o.patient;
    const order = await this.repo.insertOrder(tx, {
      tenantId,
      orderNo: await this.setup.nextNumber(tx, 'lab.order', { prefix: 'LAB' }),
      facilityId: o.facilityId,
      source: o.source,
      priority: o.priority,
      patientId: p.id,
      patientUhid: p.uhid,
      patientName: [p.firstName, p.lastName].filter(Boolean).join(' '),
      patientGender: p.gender,
      patientDob: p.dateOfBirth,
      patientMobile: p.mobile,
      doctorId: o.doctorId,
      doctorName: o.doctorName,
      referredBy: o.referredBy,
      encounterId: o.encounterId,
      clinicalNotes: o.clinicalNotes,
      createdBy: ctx?.userId ?? null,
      updatedBy: ctx?.userId ?? null,
    });

    const items = await this.repo.insertItems(
      tx,
      o.picked.map(
        (x, i): NewItemRow => ({
          tenantId,
          orderId: order.id,
          sort: i,
          kind: x.kind,
          testId: x.test?.id ?? null,
          panelId: x.panel?.id ?? null,
          code: x.code,
          name: x.name,
          price: x.test?.price ?? x.panel?.price ?? '0',
          serviceCode: x.test?.serviceCode ?? x.panel?.serviceCode ?? null,
          emrOrderId: x.emrOrderId ?? null,
        }),
      ),
    );

    // Expand panels to tests, pick the reference range for this patient, group by sample.
    const panelTests = await this.repo.panelTests(tx, o.picked.flatMap((x) => (x.panel ? [x.panel.id] : [])));
    const lines: { item: ItemRow; test: TestRow; panelName: string | null }[] = [];
    for (const item of items) {
      if (item.kind === 'test') lines.push({ item, test: o.picked[item.sort]!.test!, panelName: null });
      if (item.kind === 'panel') for (const test of panelTests.get(item.panelId!) ?? []) lines.push({ item, test, panelName: item.name });
    }
    const ranges = await this.repo.ranges(tx, [...new Set(lines.map((l) => l.test.id))]);
    const ageYears = p.dateOfBirth ? (Date.now() - Date.parse(p.dateOfBirth)) / (365.25 * 86400_000) : null;

    const groupKey = (t: TestRow) => `${t.sampleType}|${t.container ?? ''}`;
    const sampleIds = new Map<string, string>();
    for (const key of [...new Set(lines.map((l) => groupKey(l.test)))]) {
      const [sampleType, container] = key.split('|');
      const [s] = await this.repo.insertSamples(tx, [
        { tenantId, orderId: order.id, barcode: await this.nextBarcode(tx), sampleType: sampleType!, container: container || null },
      ]);
      sampleIds.set(key, s!.id);
    }

    await this.repo.insertResults(
      tx,
      lines.map(({ item, test, panelName }, i): NewResultRow => {
        const r = pickRange(ranges.filter((x) => x.testId === test.id), p.gender, ageYears);
        return {
          tenantId,
          orderId: order.id,
          itemId: item.id,
          testId: test.id,
          sampleId: sampleIds.get(groupKey(test)) ?? null,
          sort: i,
          code: test.code,
          name: test.name,
          section: test.section,
          unit: test.unit,
          method: test.method,
          resultType: test.resultType,
          options: test.options,
          decimals: test.decimals,
          panelName,
          refLow: r?.low ?? null,
          refHigh: r?.high ?? null,
          criticalLow: r?.criticalLow ?? null,
          criticalHigh: r?.criticalHigh ?? null,
          refText: r?.text ?? null,
        };
      }),
    );
    return order;
  }

  private async billTx(tx: Tx, order: OrderRow, payNow?: lab.CreateOrder['payNow']): Promise<OrderRow> {
    const items = (await this.repo.items(tx, [order.id])).filter((i) => i.kind !== 'unmatched');
    if (!items.length) throw badRequest('nothing_to_bill', 'Match the tests on this order to the catalogue before billing');
    const created = await this.billing.createInvoice(tx, {
      patientId: order.patientId,
      facilityId: order.facilityId,
      source: { module: 'lab', refId: order.id },
      ...(order.doctorId ? { doctorId: order.doctorId } : {}),
      lines: items.map((i) =>
        i.serviceCode ? { serviceCode: i.serviceCode, qty: 1 } : { description: `${i.name} (lab)`, qty: 1, unitPrice: num(i.price)!, taxRate: 0 },
      ),
      ...(payNow ? { payNow: { mode: payNow.mode, amount: payNow.amount, ref: payNow.ref } } : {}),
    });
    return this.repo.updateOrder(tx, order.id, { invoiceId: created.invoiceId, invoiceNo: created.number });
  }

  private async publishCreated(tx: Tx, order: OrderRow) {
    const event: lab.OrderCreatedEvent = {
      orderId: order.id,
      orderNo: order.orderNo,
      patientId: order.patientId,
      source: order.source as lab.OrderSource,
      encounterId: order.encounterId,
      invoiceId: order.invoiceId,
    };
    await this.outbox.publish(tx, 'lab.order.created', { ...event });
  }

  private async publishReport(tx: Tx, order: OrderRow) {
    const items = await this.repo.items(tx, [order.id]);
    const names = items.filter((i) => i.kind !== 'unmatched').map((i) => i.name);
    const title = `Lab report: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3} more` : ''}`;
    const event: lab.ReportVerifiedEvent = {
      reportId: order.id,
      orderId: order.id,
      orderNo: order.orderNo,
      patientId: order.patientId,
      doctorId: order.doctorId,
      title,
      url: `/lab/orders/${order.id}/report`,
      issuedAt: iso(order.verifiedAt ?? new Date().toISOString())!,
    };
    await this.outbox.publish(tx, 'lab.report.verified', { ...event });
  }

  /** Works out the order status from its samples and results. */
  private async recompute(tx: Tx, order: OrderRow, verified?: { verifiedAt: string; verifiedBy: string | null }): Promise<OrderRow> {
    const [samples, results] = await Promise.all([this.repo.samples(tx, [order.id]), this.repo.results(tx, [order.id])]);
    let status: lab.OrderStatus = 'ordered';
    const live = samples.filter((s) => s.status !== 'rejected');
    if (live.length && live.every((s) => s.status === 'collected' || s.status === 'received')) status = 'collected';
    if (results.some((r) => r.status !== 'pending')) status = 'in_progress';
    if (results.length && results.every((r) => r.status === 'verified')) status = 'completed';
    const values: Partial<OrderRow> = { status, updatedBy: currentContext()?.userId ?? null };
    if (status === 'completed') Object.assign(values, verified ?? {});
    else Object.assign(values, { verifiedAt: null, verifiedBy: null });
    if (status === order.status && !verified && order.verifiedAt === (values.verifiedAt ?? order.verifiedAt)) return order;
    return this.repo.updateOrder(tx, order.id, values);
  }

  private async lockOrder(tx: Tx, id: string): Promise<OrderRow> {
    const order = await this.repo.orderById(tx, id, true);
    if (!order) throw notFound('Lab order');
    return order;
  }

  private async openOrder(tx: Tx, id: string): Promise<OrderRow> {
    const order = await this.lockOrder(tx, id);
    if (order.status === 'cancelled') throw conflict('order_cancelled', 'This order is cancelled');
    return order;
  }

  private nextBarcode(tx: Tx): Promise<string> {
    return this.setup.nextNumber(tx, 'lab.sample', { prefix: 'LS', width: 7 });
  }

  private async requireTests(tx: Tx, ids: string[]) {
    const found = await this.repo.testsByIds(tx, unique(ids));
    if (found.length !== unique(ids).length) throw badRequest('unknown_test', 'One of the tests was not found');
  }

  private async testDtos(tx: Tx, rows: TestRow[]): Promise<LabTest[]> {
    const ranges = await this.repo.ranges(tx, rows.map((r) => r.id));
    return rows.map((t) => testDto(t, ranges.filter((r) => r.testId === t.id)));
  }

  private async panelDtos(tx: Tx, rows: PanelRow[]): Promise<LabPanel[]> {
    const tests = await this.repo.panelTests(tx, rows.map((r) => r.id));
    return rows.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      price: num(p.price)!,
      serviceCode: p.serviceCode,
      isActive: p.isActive,
      tests: (tests.get(p.id) ?? []).map((t) => ({ id: t.id, code: t.code, name: t.name, unit: t.unit })),
    }));
  }

  private async orderDto(tx: Tx, o: OrderRow): Promise<Order> {
    const [items, samples, results, names] = await Promise.all([
      this.repo.items(tx, [o.id]),
      this.repo.samples(tx, [o.id]),
      this.repo.results(tx, [o.id]),
      this.repo.userNames(tx, [o.verifiedBy]),
    ]);
    return {
      ...summaryDto(o, items),
      facilityId: o.facilityId,
      doctorId: o.doctorId,
      encounterId: o.encounterId,
      clinicalNotes: o.clinicalNotes,
      invoiceId: o.invoiceId,
      cancelledReason: o.cancelledReason,
      verifiedAt: o.verifiedAt ? iso(o.verifiedAt) : null,
      verifiedByName: o.verifiedBy ? (names.get(o.verifiedBy) ?? null) : null,
      items: items.map((i) => ({ id: i.id, kind: i.kind as lab.OrderItem['kind'], testId: i.testId, panelId: i.panelId, code: i.code, name: i.name, price: num(i.price)! })),
      samples: samples.map((s) => sampleDto(s, results)),
      results: results.map(resultDto),
    };
  }
}

// ---------- helpers ----------

function num(v: string | null | undefined): number | null {
  return v === null || v === undefined ? null : Number(v);
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function testColumns(d: Partial<ReturnType<typeof lab.testInputSchema.parse>>) {
  const out: Partial<TestRow> = {};
  if (d.name !== undefined) out.name = d.name;
  if (d.section !== undefined) out.section = d.section;
  if (d.sampleType !== undefined) out.sampleType = d.sampleType;
  if (d.container !== undefined) out.container = d.container || null;
  if (d.unit !== undefined) out.unit = d.unit || null;
  if (d.method !== undefined) out.method = d.method || null;
  if (d.resultType !== undefined) out.resultType = d.resultType;
  if (d.options !== undefined) out.options = d.options;
  if (d.decimals !== undefined) out.decimals = d.decimals;
  if (d.price !== undefined) out.price = String(d.price);
  if (d.serviceCode !== undefined) out.serviceCode = d.serviceCode || null;
  if (d.tatHours !== undefined) out.tatHours = d.tatHours;
  if (d.isActive !== undefined) out.isActive = d.isActive;
  return out as Omit<typeof out, 'name'> & { name: string };
}

function rangeColumns(r: ReturnType<typeof lab.rangeInputSchema.parse>) {
  const s = (v: number | undefined) => (v === undefined ? null : String(v));
  return {
    gender: r.gender,
    ageMinYears: String(r.ageMinYears),
    ageMaxYears: String(r.ageMaxYears),
    low: s(r.low),
    high: s(r.high),
    criticalLow: s(r.criticalLow),
    criticalHigh: s(r.criticalHigh),
    text: r.text || null,
  };
}

/** Gender-specific band first, then 'any'; the age band must contain the patient's age (any band when age is unknown). */
export function pickRange(ranges: RangeRow[], gender: string, ageYears: number | null): RangeRow | undefined {
  const fits = (r: RangeRow) => ageYears === null || (ageYears >= Number(r.ageMinYears) && ageYears < Number(r.ageMaxYears));
  return ranges.find((r) => r.gender === gender && fits(r)) ?? ranges.find((r) => r.gender === 'any' && fits(r)) ?? ranges.find(fits);
}

function testDto(t: TestRow, ranges: RangeRow[]): LabTest {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    section: t.section as lab.LabSection,
    sampleType: t.sampleType as lab.SampleType,
    container: t.container,
    unit: t.unit,
    method: t.method,
    resultType: t.resultType as lab.ResultType,
    options: t.options,
    decimals: t.decimals,
    price: num(t.price)!,
    serviceCode: t.serviceCode,
    tatHours: t.tatHours,
    isActive: t.isActive,
    ranges: ranges.map((r) => ({
      gender: r.gender as lab.Range['gender'],
      ageMinYears: Number(r.ageMinYears),
      ageMaxYears: Number(r.ageMaxYears),
      low: num(r.low),
      high: num(r.high),
      criticalLow: num(r.criticalLow),
      criticalHigh: num(r.criticalHigh),
      text: r.text,
    })),
  };
}

function patientDto(o: OrderRow): lab.OrderPatient {
  return { id: o.patientId, uhid: o.patientUhid, name: o.patientName, gender: o.patientGender, dateOfBirth: o.patientDob, mobile: o.patientMobile };
}

function summaryDto(o: OrderRow, items: ItemRow[]): OrderSummary {
  return {
    id: o.id,
    orderNo: o.orderNo,
    orderDate: o.orderDate,
    status: o.status as lab.OrderStatus,
    source: o.source as lab.OrderSource,
    priority: o.priority as lab.OrderPriority,
    patient: patientDto(o),
    doctorName: o.doctorName,
    referredBy: o.referredBy,
    itemNames: items.map((i) => i.name),
    invoiceNo: o.invoiceNo,
    hasCritical: o.hasCritical,
    createdAt: iso(o.createdAt),
  };
}

function sampleDto(s: SampleRow, results: ResultRow[]): lab.Sample {
  return {
    id: s.id,
    barcode: s.barcode,
    sampleType: s.sampleType as lab.SampleType,
    container: s.container,
    status: s.status as lab.SampleStatus,
    collectedAt: s.collectedAt ? iso(s.collectedAt) : null,
    receivedAt: s.receivedAt ? iso(s.receivedAt) : null,
    rejectedReason: s.rejectedReason,
    testNames: results.filter((r) => r.sampleId === s.id).map((r) => r.name),
  };
}

function resultDto(r: ResultRow): lab.Result {
  return {
    id: r.id,
    itemId: r.itemId,
    testId: r.testId,
    sampleId: r.sampleId,
    code: r.code,
    name: r.name,
    section: r.section as lab.LabSection,
    unit: r.unit,
    method: r.method,
    resultType: r.resultType as lab.ResultType,
    options: r.options,
    decimals: r.decimals,
    panelName: r.panelName,
    refLow: num(r.refLow),
    refHigh: num(r.refHigh),
    criticalLow: num(r.criticalLow),
    criticalHigh: num(r.criticalHigh),
    refText: r.refText,
    value: r.value,
    flag: r.flag as lab.ResultFlag | null,
    remarks: r.remarks,
    status: r.status as lab.ResultStatus,
    enteredAt: r.enteredAt ? iso(r.enteredAt) : null,
    verifiedAt: r.verifiedAt ? iso(r.verifiedAt) : null,
  };
}

function hasHint(e: unknown, hint: string): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 3 && cur && typeof cur === 'object'; i++) {
    if ((cur as { hint?: unknown }).hint === hint) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

export function isUniqueViolation(e: unknown, constraint: string): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 3 && cur && typeof cur === 'object'; i++) {
    const c = cur as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (c.code === '23505' && c.constraint === constraint) return true;
    cur = c.cause;
  }
  return false;
}
