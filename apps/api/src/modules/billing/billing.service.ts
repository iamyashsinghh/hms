import { HttpStatus, Injectable } from '@nestjs/common';
import { formatSeries, iso, nextCounter, type Tx } from '@hms/db';
import type { Paginated } from '@hms/shared';
import type { billing as B } from '@hms/shared';
type BillingSettings = B.BillingSettings;
type BillingSettingsInput = B.BillingSettingsInput;
type CashShift = B.CashShift;
type CloseShift = B.CloseShift;
type CollectPayment = B.CollectPayment;
type CreateInvoice = B.CreateInvoice;
type CreatedInvoice = B.CreatedInvoice;
type CreateService = B.CreateService;
type CreditNote = B.CreditNote;
type CreditNoteInput = B.CreditNoteInput;
type DepositInput = B.DepositInput;
type Invoice = B.Invoice;
type InvoiceCancelledEvent = B.InvoiceCancelledEvent;
type InvoiceFinalizedEvent = B.InvoiceFinalizedEvent;
type InvoiceLine = B.InvoiceLine;
type InvoiceLineInput = B.InvoiceLineInput;
type InvoiceStatus = B.InvoiceStatus;
type InvoiceSummary = B.InvoiceSummary;
type OpenShift = B.OpenShift;
type PatientAccount = B.PatientAccount;
type Payment = B.Payment;
type PaymentReceivedEvent = B.PaymentReceivedEvent;
type PriceList = B.PriceList;
type PriceListInput = B.PriceListInput;
type RefundInput = B.RefundInput;
type CollectPaymentTxInput = B.CollectPaymentTxInput;
type CreditNoteTxInput = B.CreditNoteTxInput;
type InvoiceReturnInput = B.InvoiceReturnInput;
type InvoiceReturnResult = B.InvoiceReturnResult;
type PortalPaymentCaptured = B.PortalPaymentCaptured;
type RefundIssuedEvent = B.RefundIssuedEvent;
type Service = B.Service;
type ServicePrice = B.ServicePrice;
type UpdateInvoice = B.UpdateInvoice;
type UpdateService = B.UpdateService;
import { billing as contracts } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { OutboxService } from '../../common/events/outbox.service';
import { currentContext } from '../../common/context/request-context';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../common/errors/errors';
import {
  BillingRepository,
  type CreditNoteRow,
  type InvoiceLineRow,
  type InvoiceRow,
  type NewInvoiceLineRow,
  type PaymentRow,
  type PriceListRow,
  type ServiceRow,
  type SettingsRow,
  type ShiftRow,
} from './billing.repository';
import { computeLine, computeTotals, paise, rupees, toNumber, upiLink, type LineOut } from './money';

/** Business date in India (the server runs in UTC). */
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/**
 * Billing rules. Other modules import BillingModule and call createInvoice()/getServicePrice()
 * (contracts in PARALLEL_PLAN.md section 4); everything else backs the /billing routes.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly db: DbService,
    private readonly repo: BillingRepository,
    private readonly outbox: OutboxService,
  ) {}

  // =====================================================================
  // Cross-module contract
  // =====================================================================

  /**
   * Create an invoice inside the caller's transaction. Lines with a serviceCode are priced from
   * the service master / price lists when unitPrice or taxRate is omitted (the charge engine).
   * Finalized (numbered) unless `finalize: false`; `payNow` records a payment straight away.
   */
  async createInvoice(tx: Tx, input: CreateInvoice): Promise<CreatedInvoice> {
    const data = contracts.createInvoiceSchema.parse(input);
    const ctx = currentContext();
    const { userId } = await this.repo.scope(tx);
    const facilityId = this.resolveFacility(data.facilityId);
    const patient = await this.repo.patientSnapshot(tx, data.patientId);
    if (!patient) throw notFound('Patient');
    const settings = await this.repo.settings(tx);
    const built = await this.buildLines(tx, data.lines, data.payerId, today());
    const totals = computeTotals(built.map((b) => b.calc), data.supplyType, settings?.roundOff ?? true);

    const row = await this.repo.insertInvoice(tx, {
      facilityId,
      patientId: patient.id,
      patientName: [patient.firstName, patient.lastName].filter(Boolean).join(' '),
      patientUhid: patient.uhid,
      patientMobile: patient.mobile,
      sourceModule: data.source?.module ?? 'billing',
      sourceRef: data.source?.refId ?? null,
      payerId: data.payerId ?? null,
      doctorId: data.doctorId ?? null,
      supplyType: data.supplyType,
      buyerGstin: data.buyerGstin ?? null,
      notes: data.notes ?? null,
      ...totalColumns(totals),
      createdBy: userId ?? ctx?.userId ?? null,
      updatedBy: userId ?? ctx?.userId ?? null,
    });
    await this.repo.replaceLines(tx, row.id, built.map((b) => b.row));

    let inv = row;
    if (data.finalize !== false || data.payNow) {
      inv = await this.finalizeTx(tx, row.id, false);
      // Finalized goes out before payment.received, already carrying the amount paid now
      // (if the payment is refused the whole transaction, events included, rolls back).
      await this.publishFinalized(tx, inv, data.payNow ? paise(data.payNow.amount) : 0);
      if (data.payNow) {
        await this.collectTx(tx, inv, { mode: data.payNow.mode, amount: data.payNow.amount, reference: data.payNow.ref });
        inv = (await this.repo.invoiceById(tx, row.id))!;
      }
    }
    return { invoiceId: inv.id, number: inv.number, total: toNumber(inv.total), status: inv.status as InvoiceStatus };
  }

  /** Price of a service for a payer today (payer list → cash list → base price). */
  async getServicePrice(serviceCode: string, payerId?: string | null, tx?: Tx): Promise<ServicePrice> {
    const run = async (t: Tx) => {
      const [svc] = await this.repo.servicesByCode(t, [serviceCode.toUpperCase()]);
      if (!svc || !svc.isActive) throw notFound(`Service ${serviceCode}`);
      const listed = (await this.repo.listPrices(t, [svc.id], payerId, today())).get(svc.id);
      return {
        serviceId: svc.id,
        serviceCode: svc.code,
        name: svc.name,
        price: toNumber(listed?.price ?? svc.basePrice),
        taxRate: toNumber(svc.taxRate),
        hsnSac: svc.hsnSac,
        priceListId: listed?.priceListId ?? null,
      };
    };
    return tx ? run(tx) : this.db.tx(run);
  }

  // =====================================================================
  // Settings
  // =====================================================================

  getSettings(): Promise<BillingSettings> {
    return this.db.tx(async (tx) => settingsDto(await this.repo.settings(tx)));
  }

  updateSettings(input: BillingSettingsInput): Promise<BillingSettings> {
    const d = contracts.billingSettingsInputSchema.parse(input);
    const ctx = currentContext()!;
    const blank = (v: string | undefined) => (v === undefined ? undefined : v || null);
    return this.db.tx(async (tx) => {
      const values = {
        legalName: blank(d.legalName),
        gstin: blank(d.gstin),
        stateCode: blank(d.stateCode),
        address: blank(d.address),
        phone: blank(d.phone),
        upiVpa: blank(d.upiVpa),
        upiPayeeName: blank(d.upiPayeeName),
        invoiceFooter: blank(d.invoiceFooter),
        roundOff: d.roundOff,
        updatedBy: ctx.userId,
      };
      const defined = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
      return settingsDto(await this.repo.upsertSettings(tx, defined));
    });
  }

  // =====================================================================
  // Services & packages
  // =====================================================================

  listServices(query: unknown): Promise<Paginated<Service>> {
    const q = contracts.serviceQuerySchema.parse(query);
    return this.db.tx(async (tx) => {
      const { items, total } = await this.repo.searchServices(tx, q);
      return { items: items.map((r) => serviceDto(r)), page: q.page, pageSize: q.pageSize, total };
    });
  }

  getService(id: string): Promise<Service> {
    return this.db.tx(async (tx) => {
      const row = await this.repo.serviceById(tx, id);
      if (!row) throw notFound('Service');
      return serviceDto(row, row.category === 'package' ? await this.repo.packageItems(tx, id) : undefined);
    });
  }

  createService(input: CreateService): Promise<Service> {
    const d = contracts.createServiceSchema.parse(input);
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const [dupe] = await this.repo.servicesByCode(tx, [d.code]);
      if (dupe) throw conflict('service_code_taken', `Service code ${d.code} is already used`);
      const row = await this.repo.insertService(tx, {
        code: d.code,
        name: d.name,
        category: d.category,
        departmentId: d.departmentId ?? null,
        hsnSac: d.hsnSac ?? null,
        basePrice: rupees(paise(d.basePrice)),
        taxRate: String(d.taxRate),
        isActive: d.isActive,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      });
      if (d.category === 'package' && d.packageItems?.length) await this.setPackageItems(tx, row.id, d.packageItems);
      return serviceDto(row, d.category === 'package' ? await this.repo.packageItems(tx, row.id) : undefined);
    });
  }

  updateService(id: string, input: UpdateService): Promise<Service> {
    const d = contracts.updateServiceSchema.parse(input);
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const row = await this.repo.updateService(tx, id, {
        ...(d.name !== undefined && { name: d.name }),
        ...(d.category !== undefined && { category: d.category }),
        ...(d.departmentId !== undefined && { departmentId: d.departmentId }),
        ...(d.hsnSac !== undefined && { hsnSac: d.hsnSac }),
        ...(d.basePrice !== undefined && { basePrice: rupees(paise(d.basePrice)) }),
        ...(d.taxRate !== undefined && { taxRate: String(d.taxRate) }),
        ...(d.isActive !== undefined && { isActive: d.isActive }),
        updatedBy: ctx.userId,
      });
      if (!row) throw notFound('Service');
      if (d.packageItems !== undefined) {
        if (row.category !== 'package') throw badRequest('not_a_package', 'Only package services can have package items');
        await this.setPackageItems(tx, id, d.packageItems);
      }
      return serviceDto(row, row.category === 'package' ? await this.repo.packageItems(tx, id) : undefined);
    });
  }

  private async setPackageItems(tx: Tx, packageId: string, items: { serviceId: string; qty: number }[]) {
    const ids = [...new Set(items.map((i) => i.serviceId))];
    if (ids.length !== items.length) throw badRequest('duplicate_items', 'A service appears twice in the package');
    if (ids.includes(packageId)) throw badRequest('package_self', 'A package cannot contain itself');
    const found = await this.repo.servicesByIds(tx, ids);
    if (found.length !== ids.length) throw notFound('Package service');
    if (found.some((s) => s.category === 'package')) throw badRequest('nested_package', 'Packages cannot contain other packages');
    await this.repo.replacePackageItems(tx, packageId, items);
  }

  // =====================================================================
  // Price lists
  // =====================================================================

  listPriceLists(): Promise<PriceList[]> {
    return this.db.tx(async (tx) => {
      const lists = await this.repo.priceLists(tx);
      const items = await this.repo.priceListItems(tx, lists.map((l) => l.id));
      return lists.map((l) => priceListDto(l, items.filter((i) => i.priceListId === l.id)));
    });
  }

  getPriceList(id: string): Promise<PriceList> {
    return this.db.tx(async (tx) => {
      const l = await this.repo.priceListById(tx, id);
      if (!l) throw notFound('Price list');
      return priceListDto(l, await this.repo.priceListItems(tx, [id]));
    });
  }

  savePriceList(id: string | null, input: PriceListInput): Promise<PriceList> {
    const d = contracts.priceListInputSchema.parse(input);
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const ids = [...new Set(d.items.map((i) => i.serviceId))];
      if (ids.length !== d.items.length) throw badRequest('duplicate_items', 'A service appears twice in the price list');
      if ((await this.repo.servicesByIds(tx, ids)).length !== ids.length) throw notFound('Service');
      const values = {
        name: d.name,
        payerId: d.payerId ?? null,
        effectiveFrom: d.effectiveFrom,
        effectiveTo: d.effectiveTo ?? null,
        isActive: d.isActive,
        updatedBy: ctx.userId,
      };
      // An edit that does not send payerId keeps the list's payer, so a payer tariff never silently becomes a cash list (BIL-46).
      const list = id
        ? await this.repo.updatePriceList(tx, id, d.payerId === undefined ? { ...values, payerId: undefined } : values)
        : await this.repo.insertPriceList(tx, { ...values, createdBy: ctx.userId });
      if (!list) throw notFound('Price list');
      await this.repo.replacePriceListItems(tx, list.id, d.items.map((i) => ({ serviceId: i.serviceId, price: rupees(paise(i.price)) })));
      return priceListDto(list, await this.repo.priceListItems(tx, [list.id]));
    });
  }

  // =====================================================================
  // Invoices
  // =====================================================================

  /** POST /billing/invoices: drafts by default; finalize/payNow need the matching permissions. */
  createInvoiceFromApi(input: CreateInvoice): Promise<Invoice> {
    const d = contracts.createInvoiceSchema.parse(input);
    if (d.finalize || d.payNow) requirePermission('billing.invoice.finalize');
    if (d.payNow) requirePermission('billing.payment.collect');
    return this.db.tx(async (tx) => {
      const created = await this.createInvoice(tx, { ...d, finalize: d.finalize ?? false });
      return this.invoiceTx(tx, created.invoiceId);
    });
  }

  listInvoices(query: unknown): Promise<Paginated<InvoiceSummary>> {
    const q = contracts.invoiceQuerySchema.parse(query);
    return this.db.tx(async (tx) => {
      const { items, total } = await this.repo.searchInvoices(tx, q);
      return { items: items.map(summaryDto), page: q.page, pageSize: q.pageSize, total };
    });
  }

  getInvoice(id: string): Promise<Invoice> {
    return this.db.tx((tx) => this.invoiceTx(tx, id));
  }

  updateDraft(id: string, input: UpdateInvoice): Promise<Invoice> {
    const d = contracts.updateInvoiceSchema.parse(input);
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const inv = await this.repo.invoiceById(tx, id, true);
      if (!inv) throw notFound('Invoice');
      if (inv.status !== 'draft') throw conflict('invoice_not_draft', 'Only draft invoices can be edited; issue a credit note instead');
      const supplyType = d.supplyType ?? (inv.supplyType as 'intra' | 'inter');
      const payerId = d.payerId !== undefined ? d.payerId : inv.payerId;
      let lineCalcs: LineOut[];
      if (d.lines) {
        const built = await this.buildLines(tx, d.lines, payerId, today());
        await this.repo.replaceLines(tx, id, built.map((b) => b.row));
        lineCalcs = built.map((b) => b.calc);
      } else {
        lineCalcs = (await this.repo.lines(tx, id)).map(lineCalcOf);
      }
      const settings = await this.repo.settings(tx);
      await this.repo.updateInvoice(tx, id, {
        supplyType,
        payerId: payerId ?? null,
        ...(d.doctorId !== undefined && { doctorId: d.doctorId }),
        ...(d.buyerGstin !== undefined && { buyerGstin: d.buyerGstin || null }),
        ...(d.notes !== undefined && { notes: d.notes || null }),
        ...totalColumns(computeTotals(lineCalcs, supplyType, settings?.roundOff ?? true)),
        updatedBy: ctx.userId,
      });
      return this.invoiceTx(tx, id);
    });
  }

  deleteDraft(id: string): Promise<void> {
    return this.db.tx(async (tx) => {
      const inv = await this.repo.invoiceById(tx, id, true);
      if (!inv) throw notFound('Invoice');
      if (inv.status !== 'draft') throw conflict('invoice_not_draft', 'Only draft invoices can be deleted');
      await this.repo.deleteInvoice(tx, id);
    });
  }

  finalize(id: string): Promise<Invoice> {
    return this.db.tx(async (tx) => {
      await this.finalizeTx(tx, id);
      return this.invoiceTx(tx, id);
    });
  }

  cancel(id: string, reason: string): Promise<Invoice> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const inv = await this.repo.invoiceById(tx, id, true);
      if (!inv) throw notFound('Invoice');
      if (inv.status === 'draft') throw conflict('invoice_is_draft', 'Delete the draft instead of cancelling it');
      if (inv.status === 'cancelled') throw conflict('invoice_cancelled', 'Invoice is already cancelled');
      if (paise(inv.paidAmount) !== 0) throw conflict('invoice_has_payments', 'Refund the payments on this invoice before cancelling it');
      await this.repo.updateInvoice(tx, id, { status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: ctx.userId, cancelReason: reason, updatedBy: ctx.userId });
      const event: InvoiceCancelledEvent = { invoiceId: id, number: inv.number!, patientId: inv.patientId };
      await this.publish(tx, 'billing.invoice.cancelled', { ...event });
      return this.invoiceTx(tx, id);
    });
  }

  private async finalizeTx(tx: Tx, id: string, publish = true): Promise<InvoiceRow> {
    const inv = await this.repo.invoiceById(tx, id, true);
    if (!inv) throw notFound('Invoice');
    if (inv.status !== 'draft') throw conflict('invoice_not_draft', `Invoice is already ${inv.status}`);
    const { userId } = await this.repo.scope(tx);
    const settings = await this.repo.settings(tx);
    const number = formatSeries('INV', await nextCounter(tx, 'billing.invoice'));
    const row = await this.repo.updateInvoice(tx, id, {
      status: 'final',
      number,
      invoiceDate: today(),
      sellerName: settings?.legalName ?? null,
      sellerGstin: settings?.gstin ?? null,
      finalizedAt: new Date().toISOString(),
      finalizedBy: userId,
      updatedBy: userId,
    });
    if (publish) await this.publishFinalized(tx, row);
    return row;
  }

  private async publishFinalized(tx: Tx, row: InvoiceRow, paidNowPaise = 0) {
    const id = row.id;
    const event: InvoiceFinalizedEvent = {
      invoiceId: id,
      number: row.number!,
      patientId: row.patientId,
      facilityId: row.facilityId,
      total: toNumber(row.total),
      source: { module: row.sourceModule, refId: row.sourceRef },
      doctorId: row.doctorId,
      invoiceDate: row.invoiceDate,
      lines: (await this.repo.lines(tx, id)).map((l) => ({
        serviceCode: l.serviceCode,
        itemId: l.itemId,
        description: l.description,
        qty: toNumber(l.qty),
        amount: toNumber(l.total),
      })),
      paid: (paise(row.paidAmount) + paidNowPaise) / 100,
      finalizedAt: iso(row.finalizedAt!),
    };
    await this.publish(tx, 'billing.invoice.finalized', { ...event });
  }

  private async buildLines(tx: Tx, lines: InvoiceLineInput[], payerId: string | null | undefined, date: string) {
    const parsed = lines.map((l) => contracts.invoiceLineInputSchema.parse(l));
    const codes = [...new Set(parsed.flatMap((l) => (l.serviceCode ? [l.serviceCode] : [])))];
    const services = new Map((await this.repo.servicesByCode(tx, codes)).map((s) => [s.code, s]));
    const missing = codes.filter((c) => !services.get(c)?.isActive);
    if (missing.length) throw badRequest('unknown_service', `Unknown or inactive service: ${missing.join(', ')}`, { missing });
    const prices = await this.repo.listPrices(tx, [...services.values()].map((s) => s.id), payerId, date);

    return parsed.map((l, idx) => {
      const svc: ServiceRow | undefined = l.serviceCode ? services.get(l.serviceCode) : undefined;
      const unitPrice = l.unitPrice !== undefined ? paise(l.unitPrice) : paise(prices.get(svc!.id)?.price ?? svc!.basePrice);
      const taxRate = l.taxRate ?? toNumber(svc?.taxRate);
      let calc: LineOut;
      try {
        calc = computeLine({ qty: l.qty, unitPrice, discount: paise(l.discount ?? 0), taxRate, priceIncludesTax: l.priceIncludesTax });
      } catch (e) {
        throw badRequest('invalid_discount', (e as Error).message, { line: idx + 1 });
      }
      const row: Omit<NewInvoiceLineRow, 'tenantId' | 'invoiceId'> = {
        lineNo: idx + 1,
        serviceId: svc?.id ?? null,
        serviceCode: svc?.code ?? null,
        itemId: l.itemId ?? null,
        description: l.description ?? svc!.name,
        hsnSac: l.hsnSac ?? svc?.hsnSac ?? null,
        qty: String(l.qty),
        // Stored ex-tax so taxable = qty × price − discount holds on the printed bill.
        unitPrice: l.priceIncludesTax ? rupees(Math.round((calc.taxable + calc.discount) / l.qty)) : rupees(unitPrice),
        discount: rupees(calc.discount),
        taxRate: String(taxRate),
        taxableAmount: rupees(calc.taxable),
        taxAmount: rupees(calc.tax),
        total: rupees(calc.total),
      };
      return { row, calc };
    });
  }

  private async invoiceTx(tx: Tx, id: string): Promise<Invoice> {
    const inv = await this.repo.invoiceById(tx, id);
    if (!inv) throw notFound('Invoice');
    const [lines, payments, creditNotes, settings] = await Promise.all([
      this.repo.lines(tx, id),
      this.repo.paymentsForInvoice(tx, id),
      this.repo.creditNotesForInvoice(tx, id),
      this.repo.settings(tx),
    ]);
    const summary = summaryDto(inv);
    const due = paise(summary.balance);
    const link =
      settings?.upiVpa && inv.status === 'final' && due > 0
        ? upiLink(settings.upiVpa, settings.upiPayeeName ?? settings.legalName ?? 'Hospital', due, inv.number!)
        : null;
    return {
      ...summary,
      patientMobile: inv.patientMobile,
      sourceRef: inv.sourceRef,
      payerId: inv.payerId,
      doctorId: inv.doctorId,
      supplyType: inv.supplyType as 'intra' | 'inter',
      buyerGstin: inv.buyerGstin,
      sellerName: inv.sellerName,
      sellerGstin: inv.sellerGstin,
      subtotal: toNumber(inv.subtotal),
      discountTotal: toNumber(inv.discountTotal),
      taxableTotal: toNumber(inv.taxableTotal),
      cgstTotal: toNumber(inv.cgstTotal),
      sgstTotal: toNumber(inv.sgstTotal),
      igstTotal: toNumber(inv.igstTotal),
      taxTotal: toNumber(inv.taxTotal),
      roundOff: toNumber(inv.roundOff),
      notes: inv.notes,
      finalizedAt: inv.finalizedAt ? iso(inv.finalizedAt) : null,
      cancelledAt: inv.cancelledAt ? iso(inv.cancelledAt) : null,
      cancelReason: inv.cancelReason,
      lines: lines.map(lineDto),
      payments: payments.map(paymentDto),
      creditNotes: creditNotes.map(creditNoteDto),
      upiLink: link,
    };
  }

  // =====================================================================
  // Payments, deposits, refunds
  // =====================================================================

  collectPayment(invoiceId: string, input: CollectPayment): Promise<Invoice> {
    const d = contracts.collectPaymentSchema.parse(input);
    return this.db.tx(async (tx) => {
      const inv = await this.repo.invoiceById(tx, invoiceId, true);
      if (!inv) throw notFound('Invoice');
      await this.collectTx(tx, inv, d);
      return this.invoiceTx(tx, invoiceId);
    });
  }

  /**
   * Cross-module (e.g. insurance settlements), inside the caller's transaction; works in the worker.
   * Records a receipt against a final invoice. With `reference`, a repeat call returns the first receipt.
   */
  async collectPaymentTx(tx: Tx, invoiceId: string, input: CollectPaymentTxInput): Promise<Payment> {
    const d = contracts.collectPaymentTxSchema.parse(input);
    const inv = await this.repo.invoiceById(tx, invoiceId, true);
    if (!inv) throw notFound('Invoice');
    if (d.reference) {
      const prior = await this.repo.invoicePaymentByReference(tx, invoiceId, d.reference);
      if (prior) return paymentDto(prior);
    }
    return paymentDto(await this.collectTx(tx, inv, d));
  }

  /**
   * Cross-module, inside the caller's transaction; works in the worker. Credits `amount` (up to the
   * unpaid balance) on a final invoice, e.g. an insurer's disallowance. Idempotent on `reference`.
   */
  async creditNoteTx(tx: Tx, invoiceId: string, input: CreditNoteTxInput): Promise<CreditNote> {
    const d = contracts.creditNoteTxSchema.parse(input);
    const inv = await this.repo.invoiceById(tx, invoiceId, true);
    if (!inv) throw notFound('Invoice');
    if (d.reference) {
      const prior = await this.repo.creditNoteByReference(tx, d.reference);
      if (prior) {
        if (prior.invoiceId !== invoiceId) throw conflict('reference_used', `Reference ${d.reference} was already credited on another invoice`);
        return creditNoteDto(prior);
      }
    }
    if (inv.status !== 'final') throw conflict('invoice_not_final', 'Credit notes can only be issued against final invoices');
    const amount = paise(d.amount);
    const balance = paise(inv.total) - paise(inv.paidAmount) - paise(inv.creditedAmount);
    if (amount > balance) throw badRequest('credit_exceeds_balance', `Only ₹${rupees(balance)} is unpaid`, { balance: toNumber(rupees(balance)) });
    return creditNoteDto(await this.insertCreditNote(tx, inv, amount, d.reason, d.reference));
  }

  /** Invoice row must be locked FOR UPDATE by the caller. */
  private async collectTx(tx: Tx, inv: InvoiceRow, d: { mode: string; amount: number; reference?: string; notes?: string }): Promise<PaymentRow> {
    if (inv.status !== 'final') throw conflict('invoice_not_final', 'Finalize the invoice before taking payment');
    const amount = paise(d.amount);
    const balance = paise(inv.total) - paise(inv.paidAmount) - paise(inv.creditedAmount);
    if (amount > balance) throw badRequest('overpayment', `Only ₹${rupees(balance)} is due on this invoice`, { balance: toNumber(rupees(balance)) });
    if (d.mode === 'deposit') {
      await this.repo.lockPatient(tx, inv.patientId);
      const available = paise(await this.repo.depositBalance(tx, inv.patientId));
      if (amount > available) throw badRequest('insufficient_deposit', `Advance balance is only ₹${rupees(available)}`, { available: toNumber(rupees(available)) });
    }
    const { userId } = await this.repo.scope(tx);
    // Gateway and insurer money never passes through a cashier's drawer.
    const inDrawer = d.mode !== 'online' && d.mode !== 'insurance';
    const shift = userId && inDrawer ? await this.repo.openShiftOf(tx, userId) : undefined;
    const payment = await this.repo.insertPayment(tx, {
      number: formatSeries('RCP', await nextCounter(tx, 'billing.receipt')),
      kind: 'payment',
      facilityId: inv.facilityId,
      patientId: inv.patientId,
      invoiceId: inv.id,
      mode: d.mode,
      amount: rupees(amount),
      reference: d.reference ?? null,
      notes: d.notes ?? null,
      shiftId: shift?.id ?? null,
      receivedBy: userId,
    });
    await this.repo.updateInvoice(tx, inv.id, { paidAmount: rupees(paise(inv.paidAmount) + amount), updatedBy: userId });
    const event: PaymentReceivedEvent = {
      paymentId: payment.id,
      invoiceId: inv.id,
      patientId: inv.patientId,
      amount: toNumber(payment.amount),
      mode: d.mode as PaymentReceivedEvent['mode'],
      kind: 'payment',
      facilityId: inv.facilityId,
      ref: payment.reference,
    };
    await this.publish(tx, 'billing.payment.received', { ...event });
    return payment;
  }

  collectDeposit(input: DepositInput): Promise<Payment> {
    const d = contracts.depositSchema.parse(input);
    const facilityId = this.resolveFacility(d.facilityId);
    return this.db.tx(async (tx) => {
      if (!(await this.repo.patientSnapshot(tx, d.patientId))) throw notFound('Patient');
      const { userId } = await this.repo.scope(tx);
      const shift = userId ? await this.repo.openShiftOf(tx, userId) : undefined;
      const row = await this.repo.insertPayment(tx, {
        number: formatSeries('RCP', await nextCounter(tx, 'billing.receipt')),
        kind: 'deposit',
        facilityId,
        patientId: d.patientId,
        mode: d.mode,
        amount: rupees(paise(d.amount)),
        reference: d.reference ?? null,
        notes: d.notes ?? null,
        shiftId: shift?.id ?? null,
        receivedBy: userId,
      });
      const event: PaymentReceivedEvent = { paymentId: row.id, invoiceId: null, patientId: d.patientId, amount: toNumber(row.amount), mode: d.mode, kind: 'deposit', facilityId, ref: row.reference };
      await this.publish(tx, 'billing.payment.received', { ...event });
      return paymentDto(row);
    });
  }

  refund(input: RefundInput): Promise<Payment> {
    const d = contracts.refundSchema.parse(input);
    return this.db.tx(async (tx) => {
      const { userId } = await this.repo.scope(tx);
      const amount = paise(d.amount);
      let patientId: string;
      let facilityId: string;
      if (d.invoiceId) {
        const inv = await this.repo.invoiceById(tx, d.invoiceId, true);
        if (!inv) throw notFound('Invoice');
        const paid = paise(inv.paidAmount);
        if (amount > paid) throw badRequest('over_refund', `Only ₹${rupees(paid)} was paid on this invoice`, { refundable: toNumber(rupees(paid)) });
        await this.repo.updateInvoice(tx, inv.id, { paidAmount: rupees(paid - amount), updatedBy: userId });
        patientId = inv.patientId;
        facilityId = inv.facilityId;
      } else {
        patientId = d.patientId!;
        if (!(await this.repo.patientSnapshot(tx, patientId))) throw notFound('Patient');
        await this.repo.lockPatient(tx, patientId);
        const available = paise(await this.repo.depositBalance(tx, patientId));
        if (amount > available) throw badRequest('over_refund', `Advance balance is only ₹${rupees(available)}`, { refundable: toNumber(rupees(available)) });
        facilityId = this.resolveFacility(d.facilityId);
      }
      const row = await this.insertRefund(tx, { facilityId, patientId, invoiceId: d.invoiceId ?? null, mode: d.mode, amount, reference: d.reference, notes: d.notes });
      return paymentDto(row);
    });
  }

  private async insertRefund(
    tx: Tx,
    r: { facilityId: string; patientId: string; invoiceId: string | null; mode: B.PaymentMode; amount: number; reference?: string; notes: string },
  ): Promise<PaymentRow> {
    const { userId } = await this.repo.scope(tx);
    const shift = userId ? await this.repo.openShiftOf(tx, userId) : undefined;
    const row = await this.repo.insertPayment(tx, {
      number: formatSeries('RFD', await nextCounter(tx, 'billing.refund')),
      kind: 'refund',
      facilityId: r.facilityId,
      patientId: r.patientId,
      invoiceId: r.invoiceId,
      mode: r.mode,
      amount: rupees(r.amount),
      reference: r.reference ?? null,
      notes: r.notes,
      shiftId: shift?.id ?? null,
      receivedBy: userId,
    });
    const event: RefundIssuedEvent = { paymentId: row.id, invoiceId: row.invoiceId, patientId: r.patientId, facilityId: r.facilityId, amount: toNumber(row.amount), mode: r.mode };
    await this.publish(tx, 'billing.refund.issued', { ...event });
    return row;
  }

  listPayments(query: unknown): Promise<Paginated<Payment>> {
    const q = contracts.paymentQuerySchema.parse(query);
    return this.db.tx(async (tx) => {
      const { items, total } = await this.repo.searchPayments(tx, q);
      return { items: items.map(paymentDto), page: q.page, pageSize: q.pageSize, total };
    });
  }

  getPayment(id: string): Promise<Payment> {
    return this.db.tx(async (tx) => {
      const row = await this.repo.paymentById(tx, id);
      if (!row) throw notFound('Receipt');
      return paymentDto(row);
    });
  }

  patientAccount(patientId: string): Promise<PatientAccount> {
    return this.db.tx(async (tx) => {
      const [deposit, outstanding, invoices, deposits] = await Promise.all([
        this.repo.depositBalance(tx, patientId),
        this.repo.outstanding(tx, patientId),
        this.repo.searchInvoices(tx, { patientId, page: 1, pageSize: 50 }),
        this.repo.deposits(tx, patientId),
      ]);
      return {
        patientId,
        depositBalance: toNumber(deposit),
        outstanding: toNumber(outstanding),
        invoices: invoices.items.map(summaryDto),
        deposits: deposits.map(paymentDto),
      };
    });
  }

  /**
   * Handler for `portal.payment.captured` (runs in the worker, at least once). Records the online
   * payment against the invoice; anything above the balance (or on a cancelled bill) is kept as advance.
   * Idempotent on the payment intent id, which is stored as the receipt reference.
   */
  recordOnlinePayment(tenantId: string, p: PortalPaymentCaptured): Promise<Payment[]> {
    return this.db.asTenant({ tenantId }, async (tx) => {
      const inv = await this.repo.invoiceById(tx, p.invoiceId, true);
      if (!inv) throw notFound('Invoice');
      if (await this.repo.paymentByReference(tx, inv.patientId, p.intentId)) return [];
      const amount = paise(p.amount);
      const due = inv.status === 'final' ? paise(inv.total) - paise(inv.paidAmount) - paise(inv.creditedAmount) : 0;
      const out: PaymentRow[] = [];
      const onBill = Math.min(amount, Math.max(due, 0));
      if (onBill > 0) {
        out.push(await this.collectTx(tx, inv, { mode: 'online', amount: onBill / 100, reference: p.intentId, notes: `Gateway payment ${p.providerPaymentId}` }));
      }
      if (amount > onBill) {
        const row = await this.repo.insertPayment(tx, {
          number: formatSeries('RCP', await nextCounter(tx, 'billing.receipt')),
          kind: 'deposit',
          facilityId: inv.facilityId,
          patientId: inv.patientId,
          mode: 'online',
          amount: rupees(amount - onBill),
          reference: p.intentId,
          notes: `Online payment ${p.providerPaymentId} above the bill balance, kept as advance`,
        });
        const event: PaymentReceivedEvent = {
          paymentId: row.id,
          invoiceId: null,
          patientId: inv.patientId,
          amount: toNumber(row.amount),
          mode: 'online',
          kind: 'deposit',
          facilityId: inv.facilityId,
          ref: p.intentId,
        };
        await this.publish(tx, 'billing.payment.received', { ...event });
        out.push(row);
      }
      return out.map(paymentDto);
    });
  }

  // =====================================================================
  // Credit notes
  // =====================================================================

  createCreditNote(invoiceId: string, input: CreditNoteInput): Promise<Invoice> {
    const d = contracts.creditNoteSchema.parse(input);
    return this.db.tx(async (tx) => {
      const inv = await this.repo.invoiceById(tx, invoiceId, true);
      if (!inv) throw notFound('Invoice');
      if (inv.status !== 'final') throw conflict('invoice_not_final', 'Credit notes can only be issued against final invoices');
      const amount = paise(d.amount);
      const balance = paise(inv.total) - paise(inv.paidAmount) - paise(inv.creditedAmount);
      if (amount > balance) {
        throw badRequest('credit_exceeds_balance', `Only ₹${rupees(balance)} is unpaid; refund the payment first to credit more`, { balance: toNumber(rupees(balance)) });
      }
      await this.insertCreditNote(tx, inv, amount, d.reason);
      return this.invoiceTx(tx, invoiceId);
    });
  }

  /**
   * Cross-module (e.g. pharmacy returns), inside the caller's transaction; works in the worker.
   * Credits `amount` on a final invoice. Whatever exceeds the unpaid balance was already paid, so it is
   * refunded first (needs `refundMode`). Idempotent on `reference`.
   */
  async returnOnInvoice(tx: Tx, invoiceId: string, input: InvoiceReturnInput): Promise<InvoiceReturnResult> {
    const d = contracts.invoiceReturnSchema.parse(input);
    const inv = await this.repo.invoiceById(tx, invoiceId, true);
    if (!inv) throw notFound('Invoice');
    if (d.reference) {
      const prior = await this.repo.creditNoteByReference(tx, d.reference);
      if (prior) {
        if (prior.invoiceId !== invoiceId) throw conflict('reference_used', `Return ${d.reference} was already credited on another invoice`);
        const refund = await this.repo.refundByReference(tx, invoiceId, d.reference);
        return returnResult(inv, prior, refund);
      }
    }
    if (inv.status !== 'final') throw conflict('invoice_not_final', 'Returns can only be credited on final invoices');
    const amount = paise(d.amount);
    const paid = paise(inv.paidAmount);
    const credited = paise(inv.creditedAmount);
    const total = paise(inv.total);
    if (amount > total - credited) {
      throw badRequest('credit_exceeds_invoice', `Only ₹${rupees(total - credited)} of this invoice can still be credited`, { creditable: toNumber(rupees(total - credited)) });
    }
    const refundAmount = Math.max(0, amount - (total - paid - credited));
    let refund: PaymentRow | undefined;
    let current = inv;
    if (refundAmount > 0) {
      if (!d.refundMode) throw badRequest('refund_mode_required', `₹${rupees(refundAmount)} was already paid and must be refunded; give refundMode`);
      const { userId } = await this.repo.scope(tx);
      current = await this.repo.updateInvoice(tx, invoiceId, { paidAmount: rupees(paid - refundAmount), updatedBy: userId });
      refund = await this.insertRefund(tx, {
        facilityId: inv.facilityId,
        patientId: inv.patientId,
        invoiceId,
        mode: d.refundMode,
        amount: refundAmount,
        reference: d.reference,
        notes: d.reason,
      });
    }
    const cn = await this.insertCreditNote(tx, current, amount, d.reason, d.reference);
    const after = (await this.repo.invoiceById(tx, invoiceId))!;
    return returnResult(after, cn, refund);
  }

  /** Invoice row must be locked and final; amount (paise) must fit in the unpaid balance. */
  private async insertCreditNote(tx: Tx, inv: InvoiceRow, amount: number, reason: string, reference?: string): Promise<CreditNoteRow> {
    const { userId } = await this.repo.scope(tx);
    const cn = await this.repo.insertCreditNote(tx, {
      number: formatSeries('CN', await nextCounter(tx, 'billing.credit_note')),
      invoiceId: inv.id,
      patientId: inv.patientId,
      amount: rupees(amount),
      reason,
      reference: reference ?? null,
      createdBy: userId,
    });
    await this.repo.updateInvoice(tx, inv.id, { creditedAmount: rupees(paise(inv.creditedAmount) + amount), updatedBy: userId });
    await this.publish(tx, 'billing.credit_note.issued', {
      creditNoteId: cn.id,
      number: cn.number,
      invoiceId: inv.id,
      patientId: inv.patientId,
      facilityId: inv.facilityId,
      amount: toNumber(cn.amount),
      reference: cn.reference,
    });
    return cn;
  }

  // =====================================================================
  // Cash shifts
  // =====================================================================

  openShift(input: OpenShift): Promise<CashShift> {
    const d = contracts.openShiftSchema.parse(input);
    const ctx = currentContext()!;
    const facilityId = this.resolveFacility(d.facilityId);
    return this.db.tx(async (tx) => {
      if (await this.repo.openShiftOf(tx, ctx.userId!)) throw conflict('shift_already_open', 'Close your current shift before opening a new one');
      const row = await this.repo.insertShift(tx, { facilityId, userId: ctx.userId!, openingCash: rupees(paise(d.openingCash)) });
      return this.shiftDto(tx, row);
    });
  }

  currentShift(): Promise<CashShift | null> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const row = await this.repo.openShiftOf(tx, ctx.userId!);
      return row ? this.shiftDto(tx, row) : null;
    });
  }

  closeShift(input: CloseShift): Promise<CashShift> {
    const d = contracts.closeShiftSchema.parse(input);
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const shift = await this.repo.openShiftOf(tx, ctx.userId!, true);
      if (!shift) throw conflict('no_open_shift', 'You have no open shift');
      const totals = await this.repo.shiftTotals(tx, shift.id);
      const expected = paise(shift.openingCash) + paise(totals.cash ?? 0);
      const counted = paise(d.countedCash);
      const row = await this.repo.updateShift(tx, shift.id, {
        status: 'closed',
        closedAt: new Date().toISOString(),
        totals,
        expectedCash: rupees(expected),
        countedCash: rupees(counted),
        difference: rupees(counted - expected),
        notes: d.notes ?? null,
      });
      await this.publish(tx, 'billing.shift.closed', { shiftId: row.id, userId: row.userId, expectedCash: toNumber(row.expectedCash), countedCash: counted / 100 });
      return this.shiftDto(tx, row);
    });
  }

  listShifts(query: { userId?: string; from?: string; to?: string; page?: number; pageSize?: number }): Promise<Paginated<CashShift>> {
    const page = Number(query.page ?? 1) || 1;
    const pageSize = Math.min(Number(query.pageSize ?? 25) || 25, 200);
    return this.db.tx(async (tx) => {
      const { items, total } = await this.repo.shifts(tx, { ...query, page, pageSize });
      return { items: await Promise.all(items.map((i) => this.shiftDto(tx, i.shift, i.userName))), page, pageSize, total };
    });
  }

  getShift(id: string): Promise<CashShift> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const row = await this.repo.shiftById(tx, id);
      if (!row || (row.userId !== ctx.userId && !ctx.permissions.has('billing.shift.read'))) throw notFound('Shift');
      return this.shiftDto(tx, row);
    });
  }

  private async shiftDto(tx: Tx, s: ShiftRow, userName?: string | null): Promise<CashShift> {
    const raw = s.status === 'open' ? await this.repo.shiftTotals(tx, s.id) : (s.totals ?? {});
    const totals = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, toNumber(v)]));
    const expected = s.status === 'open' ? (paise(s.openingCash) + paise(raw.cash ?? 0)) / 100 : toNumber(s.expectedCash);
    return {
      id: s.id,
      facilityId: s.facilityId,
      userId: s.userId,
      userName: userName !== undefined ? userName : await this.repo.userName(tx, s.userId),
      status: s.status as 'open' | 'closed',
      openedAt: iso(s.openedAt),
      openingCash: toNumber(s.openingCash),
      closedAt: s.closedAt ? iso(s.closedAt) : null,
      totals,
      expectedCash: expected,
      countedCash: s.countedCash === null ? null : toNumber(s.countedCash),
      difference: s.difference === null ? null : toNumber(s.difference),
      notes: s.notes,
    };
  }

  // =====================================================================

  /** Outbox publish with the tenant from the transaction, so it also works in the worker. */
  private async publish(tx: Tx, topic: string, payload: Record<string, unknown>) {
    const { tenantId } = await this.repo.scope(tx);
    await this.outbox.publish(tx, topic, payload, tenantId);
  }

  /** Facility for a new record: explicit id (checked against the user's access) or the request's facility. */
  private resolveFacility(explicit?: string): string {
    const ctx = currentContext();
    const id = explicit ?? ctx?.facilityId ?? undefined;
    if (!id) throw badRequest('facility_required', 'Choose a facility (X-Facility-Id header or facilityId)');
    if (explicit && ctx?.facilityIds && ctx.facilityIds !== 'all' && ctx.userId && !ctx.facilityIds.includes(explicit)) {
      throw forbidden('You do not have access to this facility');
    }
    return id;
  }
}

function requirePermission(key: string) {
  const ctx = currentContext();
  if (ctx && !ctx.permissions.has(key)) {
    throw new AppError(HttpStatus.FORBIDDEN, 'forbidden', 'You do not have permission to do this', { missing: [key] });
  }
}

// ---------- mapping ----------

function totalColumns(t: ReturnType<typeof computeTotals>) {
  return {
    subtotal: rupees(t.subtotal),
    discountTotal: rupees(t.discountTotal),
    taxableTotal: rupees(t.taxableTotal),
    cgstTotal: rupees(t.cgst),
    sgstTotal: rupees(t.sgst),
    igstTotal: rupees(t.igst),
    taxTotal: rupees(t.taxTotal),
    roundOff: rupees(t.roundOff),
    total: rupees(t.total),
  };
}

function lineCalcOf(l: InvoiceLineRow): LineOut {
  const taxable = paise(l.taxableAmount);
  const discount = paise(l.discount);
  return { gross: taxable + discount, discount, taxable, tax: paise(l.taxAmount), total: paise(l.total) };
}

function settingsDto(r: SettingsRow | undefined): BillingSettings {
  return {
    legalName: r?.legalName ?? null,
    gstin: r?.gstin ?? null,
    stateCode: r?.stateCode ?? null,
    address: r?.address ?? null,
    phone: r?.phone ?? null,
    upiVpa: r?.upiVpa ?? null,
    upiPayeeName: r?.upiPayeeName ?? null,
    invoiceFooter: r?.invoiceFooter ?? null,
    roundOff: r?.roundOff ?? true,
  };
}

function serviceDto(r: ServiceRow, pkg?: { serviceId: string; code: string; name: string; qty: string }[]): Service {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    category: r.category as Service['category'],
    departmentId: r.departmentId,
    hsnSac: r.hsnSac,
    basePrice: toNumber(r.basePrice),
    taxRate: toNumber(r.taxRate),
    isActive: r.isActive,
    ...(pkg && { packageItems: pkg.map((p) => ({ ...p, qty: toNumber(p.qty) })) }),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function priceListDto(l: PriceListRow, items: { serviceId: string; code: string; name: string; price: string }[]): PriceList {
  return {
    id: l.id,
    name: l.name,
    payerId: l.payerId,
    effectiveFrom: l.effectiveFrom,
    effectiveTo: l.effectiveTo,
    isActive: l.isActive,
    items: items.map((i) => ({ serviceId: i.serviceId, code: i.code, name: i.name, price: toNumber(i.price) })),
  };
}

function summaryDto(r: InvoiceRow): InvoiceSummary {
  const total = paise(r.total);
  const settled = paise(r.paidAmount) + paise(r.creditedAmount);
  const balance = r.status === 'final' ? total - settled : 0;
  return {
    id: r.id,
    number: r.number,
    status: r.status as InvoiceStatus,
    paymentStatus: settled >= total && r.status === 'final' ? 'paid' : settled > 0 ? 'partial' : 'unpaid',
    invoiceDate: r.invoiceDate,
    facilityId: r.facilityId,
    patientId: r.patientId,
    patientName: r.patientName,
    patientUhid: r.patientUhid,
    sourceModule: r.sourceModule,
    total: total / 100,
    paidAmount: toNumber(r.paidAmount),
    creditedAmount: toNumber(r.creditedAmount),
    balance: balance / 100,
    createdAt: iso(r.createdAt),
  };
}

function lineDto(l: InvoiceLineRow): InvoiceLine {
  return {
    id: l.id,
    lineNo: l.lineNo,
    serviceId: l.serviceId,
    serviceCode: l.serviceCode,
    itemId: l.itemId,
    description: l.description,
    hsnSac: l.hsnSac,
    qty: toNumber(l.qty),
    unitPrice: toNumber(l.unitPrice),
    discount: toNumber(l.discount),
    taxRate: toNumber(l.taxRate),
    taxableAmount: toNumber(l.taxableAmount),
    taxAmount: toNumber(l.taxAmount),
    total: toNumber(l.total),
  };
}

function paymentDto(p: PaymentRow): Payment {
  return {
    id: p.id,
    number: p.number,
    kind: p.kind as Payment['kind'],
    facilityId: p.facilityId,
    patientId: p.patientId,
    invoiceId: p.invoiceId,
    mode: p.mode as Payment['mode'],
    amount: toNumber(p.amount),
    reference: p.reference,
    notes: p.notes,
    shiftId: p.shiftId,
    receivedBy: p.receivedBy,
    receivedAt: iso(p.receivedAt),
  };
}

function creditNoteDto(c: CreditNoteRow): CreditNote {
  return { id: c.id, number: c.number, invoiceId: c.invoiceId, patientId: c.patientId, amount: toNumber(c.amount), reason: c.reason, reference: c.reference, createdAt: iso(c.createdAt) };
}

function returnResult(inv: InvoiceRow, cn: CreditNoteRow, refund: PaymentRow | undefined): InvoiceReturnResult {
  return {
    invoiceId: inv.id,
    creditNoteId: cn.id,
    creditNoteNumber: cn.number,
    refundId: refund?.id ?? null,
    refundNumber: refund?.number ?? null,
    refundAmount: refund ? toNumber(refund.amount) : 0,
    balance: (paise(inv.total) - paise(inv.paidAmount) - paise(inv.creditedAmount)) / 100,
  };
}
