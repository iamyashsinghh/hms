import { Injectable } from '@nestjs/common';
import {
  and,
  count,
  desc,
  eq,
  formatSeries,
  inArray,
  iso,
  nextCounter,
  pharmacyBatches,
  pharmacyItems,
  pharmacyPrescriptionLines,
  pharmacyPrescriptions,
  pharmacySaleLines,
  pharmacySaleReturnLines,
  pharmacySaleReturns,
  pharmacySales,
  sql,
  type Tx,
} from '@hms/db';
import { pharmacy } from '@hms/shared';
import type { z } from 'zod';
import { DbService } from '../../common/db/db.service';
import { OutboxService } from '../../common/events/outbox.service';
import { currentContext } from '../../common/context/request-context';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { PharmacyBillingGateway, type PharmacyInvoiceInput } from './billing.gateway';
import { pgCode } from './catalog.service';
import { lineAmounts, num, refundFor, toPaise, toRupees } from './money';
import { PharmacyStockService } from './stock.service';

type SaleRow = typeof pharmacySales.$inferSelect;
type PaymentMode = (typeof pharmacy.PAYMENT_MODES)[number];

interface SaleLineRequest {
  itemId: string;
  qty: number;
  batchId?: string;
  discountPct: number;
  prescriptionLineId?: string;
}

interface SaleRequest {
  type: 'otc' | 'rx';
  storeId: string;
  patientId?: string;
  customerName?: string;
  customerMobile?: string;
  pharmacyPrescriptionId?: string;
  paymentMode: PaymentMode;
  lines: SaleLineRequest[];
}

/** OTC sales, prescription dispensing and returns. Stock moves FEFO through PharmacyStockService. */
@Injectable()
export class PharmacySalesService {
  constructor(
    private readonly db: DbService,
    private readonly stock: PharmacyStockService,
    private readonly billing: PharmacyBillingGateway,
    private readonly outbox: OutboxService,
  ) {}

  createSale(input: z.output<typeof pharmacy.createSaleSchema>): Promise<pharmacy.Sale> {
    return this.db.tx(async (tx) => {
      const items = await tx.select().from(pharmacyItems).where(inArray(pharmacyItems.id, [...new Set(input.lines.map((l) => l.itemId))]));
      for (const item of items) {
        if (item.schedule === 'X' || item.schedule === 'narcotic') {
          throw badRequest('prescription_required', `${item.name} (Schedule ${item.schedule}) can only be dispensed against a prescription`);
        }
        if (pharmacy.RX_ONLY_SCHEDULES.includes(item.schedule) && !input.prescriptionSeen) {
          throw badRequest('prescription_required', `${item.name} is a Schedule ${item.schedule} drug; confirm the prescription was seen`);
        }
      }
      const sale = await this.recordSale(tx, { ...input, type: 'otc' });
      return this.saleDetail(tx, sale.id);
    });
  }

  dispense(pharmacyPrescriptionId: string, input: z.output<typeof pharmacy.dispenseSchema>): Promise<pharmacy.Sale> {
    return this.db.tx(async (tx) => {
      const [rx] = await tx
        .select()
        .from(pharmacyPrescriptions)
        .where(eq(pharmacyPrescriptions.id, pharmacyPrescriptionId))
        .for('update')
        .limit(1);
      if (!rx) throw notFound('Prescription');
      if (rx.status === 'dispensed' || rx.status === 'cancelled') throw conflict('prescription_closed', `This prescription is already ${rx.status}`);

      const rxLines = await tx.select().from(pharmacyPrescriptionLines).where(eq(pharmacyPrescriptionLines.pharmacyPrescriptionId, rx.id));
      const byId = new Map(rxLines.map((l) => [l.id, l]));
      const requested = new Map<string, number>();
      const lines: SaleLineRequest[] = input.lines.map((l) => {
        const rl = byId.get(l.prescriptionLineId);
        if (!rl) throw badRequest('unknown_prescription_line', 'A line does not belong to this prescription');
        const itemId = l.itemId ?? rl.itemId;
        if (!itemId) throw badRequest('item_required', `Pick the item to give for ${rl.drugName}`);
        const total = (requested.get(rl.id) ?? 0) + l.qty;
        requested.set(rl.id, total);
        if (rl.qty > 0 && rl.dispensedQty + total > rl.qty) {
          throw badRequest('over_dispense', `${rl.drugName}: prescribed ${rl.qty}, already given ${rl.dispensedQty}`);
        }
        return { itemId, qty: l.qty, batchId: l.batchId, discountPct: l.discountPct, prescriptionLineId: rl.id };
      });

      const sale = await this.recordSale(tx, {
        type: 'rx',
        storeId: input.storeId,
        patientId: rx.patientId,
        pharmacyPrescriptionId: rx.id,
        paymentMode: input.paymentMode,
        lines,
      });

      let allDone = true;
      for (const rl of rxLines) {
        const given = rl.dispensedQty + (requested.get(rl.id) ?? 0);
        if (requested.has(rl.id)) {
          await tx.update(pharmacyPrescriptionLines).set({ dispensedQty: given }).where(eq(pharmacyPrescriptionLines.id, rl.id));
        }
        if (rl.qty > 0 ? given < rl.qty : given === 0) allDone = false;
      }
      const status = allDone ? 'dispensed' : 'partial';
      await tx.update(pharmacyPrescriptions).set({ status, updatedBy: currentContext()?.userId }).where(eq(pharmacyPrescriptions.id, rx.id));

      const event: pharmacy.PharmacyDispenseCompletedEvent = {
        prescriptionId: rx.prescriptionId,
        pharmacyPrescriptionId: rx.id,
        saleId: sale.id,
        invoiceId: sale.invoiceId,
        patientId: rx.patientId,
        status,
      };
      await this.outbox.publish(tx, 'pharmacy.dispense.completed', { ...event });
      return this.saleDetail(tx, sale.id);
    });
  }

  /** Allocates batches, moves stock, prices lines, writes the sale and raises the invoice. */
  private async recordSale(tx: Tx, req: SaleRequest): Promise<SaleRow> {
    const ctx = currentContext()!;
    const store = await this.stock.storeForWrite(tx, req.storeId);
    const itemIds = [...new Set(req.lines.map((l) => l.itemId))];
    const items = new Map((await tx.select().from(pharmacyItems).where(inArray(pharmacyItems.id, itemIds))).map((i) => [i.id, i]));
    for (const id of itemIds) {
      const item = items.get(id);
      if (!item) throw notFound('Item');
      if (!item.isActive) throw badRequest('item_inactive', `${item.name} is inactive`);
      // Items saved before GST slabs were enforced may carry a rate Billing refuses (e.g. 7%). Stop before any
      // stock moves, with a message that says how to fix it, instead of failing inside the invoice.
      if (req.patientId && !pharmacy.isGstSlab(num(item.gstRate))) {
        throw badRequest(
          'gst_rate_not_slab',
          `${item.name} has GST ${num(item.gstRate)}%, which Billing cannot bill. Edit the drug and pick a GST slab (${pharmacy.GST_SLAB_MESSAGE.replace('Use a GST slab: ', '')}).`,
        );
      }
    }

    const number = formatSeries('PH', await nextCounter(tx, 'pharmacy.sale'));
    const [sale] = await tx
      .insert(pharmacySales)
      .values({
        tenantId: ctx.tenantId!,
        number,
        type: req.type,
        facilityId: store.facilityId,
        storeId: store.id,
        patientId: req.patientId ?? null,
        customerName: req.customerName ?? null,
        customerMobile: req.customerMobile ?? null,
        pharmacyPrescriptionId: req.pharmacyPrescriptionId ?? null,
        subtotal: '0',
        taxableAmount: '0',
        taxAmount: '0',
        total: '0',
        paymentMode: req.paymentMode,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning()
      .catch((e: unknown) => {
        if (pgCode(e) === '23503') throw badRequest('unknown_patient', 'Patient not found');
        throw e;
      });

    const totals = { gross: 0, discount: 0, taxable: 0, tax: 0, amount: 0 };
    const invoiceLines: PharmacyInvoiceInput['lines'] = [];
    const removed = new Map<string, number>();
    for (const l of req.lines) {
      const item = items.get(l.itemId)!;
      const gstRate = num(item.gstRate);
      for (const a of await this.stock.allocate(tx, store.id, item.id, l.qty, l.batchId)) {
        const amt = lineAmounts(toPaise(a.batch.saleRate), a.qty, l.discountPct, gstRate);
        await tx.insert(pharmacySaleLines).values({
          tenantId: ctx.tenantId!,
          saleId: sale!.id,
          itemId: item.id,
          batchId: a.batch.id,
          pharmacyPrescriptionLineId: l.prescriptionLineId ?? null,
          qty: a.qty,
          unitPrice: a.batch.saleRate,
          discountPct: String(l.discountPct),
          gstRate: String(gstRate),
          taxableAmount: toRupees(amt.taxable),
          taxAmount: toRupees(amt.tax),
          amount: toRupees(amt.amount),
        });
        await this.stock.stockOut(tx, {
          storeId: store.id,
          itemId: item.id,
          batchId: a.batch.id,
          qty: a.qty,
          txnType: req.type === 'rx' ? 'dispense' : 'sale',
          refType: 'sale',
          refId: sale!.id,
          note: number,
        });
        totals.gross += amt.gross;
        totals.discount += amt.discount;
        totals.taxable += amt.taxable;
        totals.tax += amt.tax;
        totals.amount += amt.amount;
        invoiceLines.push({
          itemId: item.id,
          description: `${item.name} (batch ${a.batch.batchNo}, exp ${a.batch.expiryDate})`,
          hsnSac: item.hsnCode ?? undefined,
          qty: a.qty,
          unitPrice: num(a.batch.saleRate),
          taxRate: gstRate,
          discount: Number(toRupees(amt.discount)),
        });
      }
      removed.set(item.id, (removed.get(item.id) ?? 0) + l.qty);
    }
    for (const [itemId, qty] of removed) await this.stock.checkLow(tx, store.id, itemId, qty);

    const invoice = req.patientId
      ? await this.billing.createInvoice(tx, {
          patientId: req.patientId,
          facilityId: store.facilityId,
          source: { module: 'pharmacy', refId: sale!.id },
          lines: invoiceLines,
          payNow: req.paymentMode === 'credit' ? undefined : { mode: req.paymentMode, ref: number },
        })
      : null;

    const [done] = await tx
      .update(pharmacySales)
      .set({
        subtotal: toRupees(totals.gross),
        discount: toRupees(totals.discount),
        taxableAmount: toRupees(totals.taxable),
        taxAmount: toRupees(totals.tax),
        total: toRupees(totals.amount),
        invoiceId: invoice?.invoiceId ?? null,
        invoiceNumber: invoice?.number ?? null,
      })
      .where(eq(pharmacySales.id, sale!.id))
      .returning();
    return done!;
  }

  createReturn(saleId: string, input: z.output<typeof pharmacy.createSaleReturnSchema>): Promise<pharmacy.SaleReturn> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const [sale] = await tx.select().from(pharmacySales).where(eq(pharmacySales.id, saleId)).for('update').limit(1);
      if (!sale) throw notFound('Sale');
      await this.stock.storeForWrite(tx, sale.storeId);
      const lines = new Map((await tx.select().from(pharmacySaleLines).where(eq(pharmacySaleLines.saleId, sale.id))).map((l) => [l.id, l]));

      const number = formatSeries('PR', await nextCounter(tx, 'pharmacy.return'));
      const [ret] = await tx
        .insert(pharmacySaleReturns)
        .values({ tenantId: ctx.tenantId!, number, saleId: sale.id, refundAmount: '0', refundMode: input.refundMode, reason: input.reason ?? null, createdBy: ctx.userId })
        .returning();

      let refund = 0;
      for (const r of input.lines) {
        const line = lines.get(r.saleLineId);
        if (!line) throw badRequest('unknown_sale_line', 'A line does not belong to this sale');
        if (line.returnedQty + r.qty > line.qty) {
          throw badRequest('over_return', `Only ${line.qty - line.returnedQty} left to return on this line`);
        }
        const amount = refundFor(toPaise(line.amount), line.qty, line.returnedQty, r.qty);
        refund += amount;
        line.returnedQty += r.qty;
        await tx.update(pharmacySaleLines).set({ returnedQty: line.returnedQty }).where(eq(pharmacySaleLines.id, line.id));
        await tx.insert(pharmacySaleReturnLines).values({ tenantId: ctx.tenantId!, returnId: ret!.id, saleLineId: line.id, qty: r.qty, amount: toRupees(amount) });
        await this.stock.stockIn(tx, {
          storeId: sale.storeId,
          itemId: line.itemId,
          batchId: line.batchId,
          qty: r.qty,
          txnType: 'sale_return',
          refType: 'sale_return',
          refId: ret!.id,
          note: `${number} against ${sale.number}`,
        });
      }

      const all = [...lines.values()];
      const status = all.every((l) => l.returnedQty === l.qty) ? 'returned' : 'partially_returned';

      // Invoiced sale: credit the return on the invoice (billing refunds the part already paid). On the last
      // return, credit whatever is left so billing's rupee round-off is returned too.
      let billingRefs: Partial<typeof pharmacySaleReturns.$inferInsert> = {};
      if (sale.invoiceId && refund > 0) {
        const amount = status === 'returned' ? toPaise(await this.billing.creditable(sale.invoiceId)) : refund;
        if (amount > 0) {
          const res = await this.billing.returnOnInvoice(tx, sale.invoiceId, {
            amount: Number(toRupees(amount)),
            reason: input.reason && input.reason.length >= 3 ? input.reason : `Pharmacy return ${number} against ${sale.number}`,
            refundMode: input.refundMode,
            reference: ret!.id,
          });
          refund = amount;
          billingRefs = { creditNoteId: res.creditNoteId, creditNoteNumber: res.creditNoteNumber, billingRefundNumber: res.refundNumber };
        }
      }
      await tx
        .update(pharmacySales)
        .set({ returnedAmount: toRupees(toPaise(sale.returnedAmount) + refund), status, updatedBy: ctx.userId })
        .where(eq(pharmacySales.id, sale.id));
      const [done] = await tx
        .update(pharmacySaleReturns)
        .set({ refundAmount: toRupees(refund), ...billingRefs })
        .where(eq(pharmacySaleReturns.id, ret!.id))
        .returning();
      return returnDto(done!);
    });
  }

  listSales(q: z.output<typeof pharmacy.saleListQuerySchema>): Promise<{ items: pharmacy.Sale[]; page: number; pageSize: number; total: number }> {
    return this.db.tx(async (tx) => {
      const term = q.q?.toLowerCase();
      const day = sql`(${pharmacySales.createdAt} at time zone 'Asia/Kolkata')::date`;
      const filter = and(
        q.type ? eq(pharmacySales.type, q.type) : undefined,
        q.from ? sql`${day} >= ${q.from}::date` : undefined,
        q.to ? sql`${day} <= ${q.to}::date` : undefined,
        term
          ? sql`(lower(${pharmacySales.number}) = ${term} or ${pharmacySales.customerMobile} like ${term + '%'}
                or lower(coalesce(${pharmacySales.customerName}, '')) like ${'%' + term + '%'})`
          : undefined,
      );
      const [rows, [{ total }]] = await Promise.all([
        tx.select().from(pharmacySales).where(filter).orderBy(desc(pharmacySales.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ total: count() }).from(pharmacySales).where(filter),
      ]);
      return { items: rows.map(saleDto), page: q.page, pageSize: q.pageSize, total };
    });
  }

  getSale(id: string): Promise<pharmacy.Sale & { returns: pharmacy.SaleReturn[] }> {
    return this.db.tx(async (tx) => {
      const sale = await this.saleDetail(tx, id);
      const returns = await tx.select().from(pharmacySaleReturns).where(eq(pharmacySaleReturns.saleId, id)).orderBy(desc(pharmacySaleReturns.createdAt));
      return { ...sale, returns: returns.map(returnDto) };
    });
  }

  private async saleDetail(tx: Tx, id: string): Promise<pharmacy.Sale> {
    const [sale] = await tx.select().from(pharmacySales).where(eq(pharmacySales.id, id)).limit(1);
    if (!sale) throw notFound('Sale');
    const lines = await tx
      .select({ l: pharmacySaleLines, itemName: pharmacyItems.name, batchNo: pharmacyBatches.batchNo, expiryDate: pharmacyBatches.expiryDate })
      .from(pharmacySaleLines)
      .innerJoin(pharmacyItems, and(eq(pharmacyItems.tenantId, pharmacySaleLines.tenantId), eq(pharmacyItems.id, pharmacySaleLines.itemId)))
      .innerJoin(pharmacyBatches, and(eq(pharmacyBatches.tenantId, pharmacySaleLines.tenantId), eq(pharmacyBatches.id, pharmacySaleLines.batchId)))
      .where(eq(pharmacySaleLines.saleId, id))
      .orderBy(pharmacySaleLines.id);
    return {
      ...saleDto(sale),
      lines: lines.map(({ l, itemName, batchNo, expiryDate }) => ({
        id: l.id,
        itemId: l.itemId,
        itemName,
        batchId: l.batchId,
        batchNo,
        expiryDate,
        qty: l.qty,
        returnedQty: l.returnedQty,
        unitPrice: num(l.unitPrice),
        discountPct: num(l.discountPct),
        gstRate: num(l.gstRate),
        taxableAmount: num(l.taxableAmount),
        taxAmount: num(l.taxAmount),
        amount: num(l.amount),
      })),
    };
  }
}

function saleDto(s: SaleRow): pharmacy.Sale {
  return {
    id: s.id,
    number: s.number,
    type: s.type as pharmacy.Sale['type'],
    facilityId: s.facilityId,
    storeId: s.storeId,
    patientId: s.patientId,
    customerName: s.customerName,
    customerMobile: s.customerMobile,
    pharmacyPrescriptionId: s.pharmacyPrescriptionId,
    status: s.status as pharmacy.Sale['status'],
    subtotal: num(s.subtotal),
    discount: num(s.discount),
    taxableAmount: num(s.taxableAmount),
    taxAmount: num(s.taxAmount),
    total: num(s.total),
    returnedAmount: num(s.returnedAmount),
    paymentMode: s.paymentMode as pharmacy.Sale['paymentMode'],
    invoiceId: s.invoiceId,
    invoiceNumber: s.invoiceNumber,
    createdAt: iso(s.createdAt),
  };
}

function returnDto(r: typeof pharmacySaleReturns.$inferSelect): pharmacy.SaleReturn {
  return {
    id: r.id,
    number: r.number,
    saleId: r.saleId,
    refundAmount: num(r.refundAmount),
    refundMode: r.refundMode,
    reason: r.reason,
    creditNoteNumber: r.creditNoteNumber,
    billingRefundNumber: r.billingRefundNumber,
    createdAt: iso(r.createdAt),
  };
}
