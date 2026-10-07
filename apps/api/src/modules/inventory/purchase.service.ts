import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  formatSeries,
  inArray,
  inventoryGrnLines,
  inventoryGrns,
  inventoryPurchaseOrderLines,
  inventoryPurchaseOrders,
  inventoryPurchaseReturnLines,
  inventoryPurchaseReturns,
  inventoryRequisitionLines,
  inventoryRequisitions,
  inventoryVendors,
  iso,
  nextCounter,
  sql,
  type Tx,
} from '@hms/db';
import type { inventory, Paginated, pharmacy } from '@hms/shared';
import type { z } from 'zod';
import { DbService } from '../../common/db/db.service';
import { currentContext } from '../../common/context/request-context';
import { OutboxService } from '../../common/events/outbox.service';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { num, purchaseLine, toPaise, toRupees } from './money';
import { InventoryStockGateway, NO_BATCH, NO_EXPIRY, assertFacility, visibleFacilities } from './stock.gateway';

type ReqRow = typeof inventoryRequisitions.$inferSelect;
type ReqLineRow = typeof inventoryRequisitionLines.$inferSelect;
type PoRow = typeof inventoryPurchaseOrders.$inferSelect;
type PoLineRow = typeof inventoryPurchaseOrderLines.$inferSelect;
type GrnRow = typeof inventoryGrns.$inferSelect;
type GrnLineRow = typeof inventoryGrnLines.$inferSelect;

const RECEIVABLE: inventory.PoStatus[] = ['approved', 'partially_received'];

/** Purchase requisitions → purchase orders → goods receipts → purchase returns. */
@Injectable()
export class InventoryPurchaseService {
  constructor(
    private readonly db: DbService,
    private readonly stock: InventoryStockGateway,
    private readonly outbox: OutboxService,
  ) {}

  // ---------- requisitions ----------

  listRequisitions(q: z.output<typeof inventory.requisitionQuerySchema>): Promise<Paginated<inventory.Requisition>> {
    return this.db.tx(async (tx) => {
      const facilities = visibleFacilities();
      const where = and(
        q.status ? eq(inventoryRequisitions.status, q.status) : undefined,
        facilities ? inArray(inventoryRequisitions.facilityId, facilities) : undefined,
      );
      const [rows, [{ total }]] = await Promise.all([
        tx.select().from(inventoryRequisitions).where(where).orderBy(desc(inventoryRequisitions.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ total: count() }).from(inventoryRequisitions).where(where),
      ]);
      return { items: rows.map((r) => reqDto(r)), page: q.page, pageSize: q.pageSize, total };
    });
  }

  getRequisition(id: string): Promise<inventory.Requisition> {
    return this.db.tx(async (tx) => {
      const row = await this.reqRow(tx, id);
      return reqDto(row, await tx.select().from(inventoryRequisitionLines).where(eq(inventoryRequisitionLines.requisitionId, id)).orderBy(asc(inventoryRequisitionLines.lineNo)));
    });
  }

  async createRequisition(input: z.output<typeof inventory.createRequisitionSchema>): Promise<inventory.Requisition> {
    const ctx = currentContext()!;
    const items = await this.stock.items(input.lines.map((l) => l.itemId));
    return this.db.tx(async (tx) => {
      const store = await this.stock.storeForUse(tx, input.storeId);
      const number = formatSeries('PRQ', await nextCounter(tx, 'inventory.requisition'));
      const [row] = await tx
        .insert(inventoryRequisitions)
        .values({
          tenantId: ctx.tenantId!,
          number,
          facilityId: store.facilityId,
          storeId: store.id,
          storeName: store.name,
          neededBy: input.neededBy ?? null,
          notes: input.notes ?? null,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning();
      const lines = await tx
        .insert(inventoryRequisitionLines)
        .values(
          input.lines.map((l, i) => {
            const item = items.get(l.itemId)!;
            return { tenantId: ctx.tenantId!, requisitionId: row!.id, lineNo: i + 1, itemId: item.id, itemCode: item.code, itemName: item.name, unit: item.unit, qty: l.qty, note: l.note ?? null };
          }),
        )
        .returning();
      return reqDto(row!, lines);
    });
  }

  decideRequisition(id: string, input: z.output<typeof inventory.decisionSchema>): Promise<inventory.Requisition> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const req = await this.reqRow(tx, id, true);
      if (req.status !== 'submitted') throw conflict('invalid_status', `Requisition ${req.number} is ${req.status}`);
      const [row] = await tx
        .update(inventoryRequisitions)
        .set({ status: input.approve ? 'approved' : 'rejected', decidedBy: ctx.userId, decidedAt: sql`now()`, decisionNote: input.note ?? null, updatedBy: ctx.userId })
        .where(eq(inventoryRequisitions.id, id))
        .returning();
      return reqDto(row!);
    });
  }

  cancelRequisition(id: string): Promise<inventory.Requisition> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const req = await this.reqRow(tx, id, true);
      if (req.status !== 'submitted' && req.status !== 'approved') throw conflict('invalid_status', `Requisition ${req.number} is ${req.status}`);
      const [row] = await tx.update(inventoryRequisitions).set({ status: 'cancelled', updatedBy: ctx.userId }).where(eq(inventoryRequisitions.id, id)).returning();
      return reqDto(row!);
    });
  }

  private async reqRow(tx: Tx, id: string, forUpdate = false): Promise<ReqRow> {
    const q = tx.select().from(inventoryRequisitions).where(eq(inventoryRequisitions.id, id)).limit(1);
    const [row] = forUpdate ? await q.for('update') : await q;
    if (!row) throw notFound('Requisition');
    assertFacility(row.facilityId);
    return row;
  }

  // ---------- purchase orders ----------

  listPurchaseOrders(q: z.output<typeof inventory.purchaseOrderQuerySchema>): Promise<Paginated<inventory.PurchaseOrder>> {
    return this.db.tx(async (tx) => {
      const facilities = visibleFacilities();
      const where = and(
        q.status ? eq(inventoryPurchaseOrders.status, q.status) : undefined,
        q.open ? inArray(inventoryPurchaseOrders.status, RECEIVABLE) : undefined,
        q.vendorId ? eq(inventoryPurchaseOrders.vendorId, q.vendorId) : undefined,
        q.q ? sql`(upper(${inventoryPurchaseOrders.number}) = upper(${q.q}) or lower(${inventoryPurchaseOrders.vendorName}) like ${'%' + q.q.toLowerCase() + '%'})` : undefined,
        facilities ? inArray(inventoryPurchaseOrders.facilityId, facilities) : undefined,
      );
      const [rows, [{ total }]] = await Promise.all([
        tx.select().from(inventoryPurchaseOrders).where(where).orderBy(desc(inventoryPurchaseOrders.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ total: count() }).from(inventoryPurchaseOrders).where(where),
      ]);
      return { items: rows.map((r) => poDto(r)), page: q.page, pageSize: q.pageSize, total };
    });
  }

  getPurchaseOrder(id: string): Promise<inventory.PurchaseOrder> {
    return this.db.tx(async (tx) => poDto(await this.poRow(tx, id), await this.poLines(tx, id)));
  }

  async createPurchaseOrder(input: z.output<typeof inventory.createPurchaseOrderSchema>): Promise<inventory.PurchaseOrder> {
    const ctx = currentContext()!;
    const items = await this.stock.items(input.lines.map((l) => l.itemId));
    return this.db.tx(async (tx) => {
      const store = await this.stock.storeForUse(tx, input.storeId);
      const vendor = await this.activeVendor(tx, input.vendorId);
      if (input.requisitionId) {
        const req = await this.reqRow(tx, input.requisitionId, true);
        if (req.status !== 'approved') throw conflict('requisition_not_approved', `Requisition ${req.number} is ${req.status}`);
        await tx.update(inventoryRequisitions).set({ status: 'ordered', updatedBy: ctx.userId }).where(eq(inventoryRequisitions.id, req.id));
      }
      const number = formatSeries('PO', await nextCounter(tx, 'inventory.po'));
      const [po] = await tx
        .insert(inventoryPurchaseOrders)
        .values({
          tenantId: ctx.tenantId!,
          number,
          facilityId: store.facilityId,
          storeId: store.id,
          storeName: store.name,
          vendorId: vendor.id,
          vendorName: vendor.name,
          requisitionId: input.requisitionId ?? null,
          expectedDate: input.expectedDate ?? null,
          terms: input.terms ?? null,
          notes: input.notes ?? null,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning();
      const done = await this.writeLines(tx, po!.id, input.lines, items);
      return poDto(done.po, done.lines);
    });
  }

  async updatePurchaseOrder(id: string, input: z.output<typeof inventory.updatePurchaseOrderSchema>): Promise<inventory.PurchaseOrder> {
    const ctx = currentContext()!;
    const items = input.lines ? await this.stock.items(input.lines.map((l) => l.itemId)) : null;
    return this.db.tx(async (tx) => {
      const po = await this.poRow(tx, id, true);
      if (po.status !== 'draft') throw conflict('po_not_draft', `${po.number} is ${po.status}; only drafts can be edited`);
      const patch: Partial<typeof inventoryPurchaseOrders.$inferInsert> = { updatedBy: ctx.userId };
      if (input.vendorId) {
        const vendor = await this.activeVendor(tx, input.vendorId);
        patch.vendorId = vendor.id;
        patch.vendorName = vendor.name;
      }
      if (input.expectedDate !== undefined) patch.expectedDate = input.expectedDate || null;
      if (input.terms !== undefined) patch.terms = input.terms || null;
      if (input.notes !== undefined) patch.notes = input.notes || null;
      await tx.update(inventoryPurchaseOrders).set(patch).where(eq(inventoryPurchaseOrders.id, id));
      if (input.lines && items) {
        await tx.delete(inventoryPurchaseOrderLines).where(eq(inventoryPurchaseOrderLines.purchaseOrderId, id));
        const done = await this.writeLines(tx, id, input.lines, items);
        return poDto(done.po, done.lines);
      }
      return poDto(await this.poRow(tx, id), await this.poLines(tx, id));
    });
  }

  approvePurchaseOrder(id: string): Promise<inventory.PurchaseOrder> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const po = await this.poRow(tx, id, true);
      if (po.status !== 'draft') throw conflict('invalid_status', `${po.number} is ${po.status}`);
      const [vendor] = await tx.select({ isActive: inventoryVendors.isActive }).from(inventoryVendors).where(eq(inventoryVendors.id, po.vendorId));
      if (!vendor?.isActive) throw conflict('vendor_inactive', `${po.vendorName} is inactive`);
      const [row] = await tx
        .update(inventoryPurchaseOrders)
        .set({ status: 'approved', approvedBy: ctx.userId, approvedAt: sql`now()`, updatedBy: ctx.userId })
        .where(eq(inventoryPurchaseOrders.id, id))
        .returning();
      const event: inventory.InventoryPoApprovedEvent = { purchaseOrderId: po.id, number: po.number, vendorId: po.vendorId, storeId: po.storeId, total: num(po.total) };
      await this.outbox.publish(tx, 'inventory.po.approved', { ...event });
      return poDto(row!, await this.poLines(tx, id));
    });
  }

  cancelPurchaseOrder(id: string, input: z.output<typeof inventory.closePurchaseOrderSchema>): Promise<inventory.PurchaseOrder> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const po = await this.poRow(tx, id, true);
      if (po.status !== 'draft' && po.status !== 'approved') {
        throw conflict('invalid_status', `${po.number} is ${po.status}; close it instead of cancelling`);
      }
      const [row] = await tx
        .update(inventoryPurchaseOrders)
        .set({ status: 'cancelled', closedReason: input.reason, updatedBy: ctx.userId })
        .where(eq(inventoryPurchaseOrders.id, id))
        .returning();
      return poDto(row!, await this.poLines(tx, id));
    });
  }

  /** Short-close a partly received PO: the rest will not come. */
  closePurchaseOrder(id: string, input: z.output<typeof inventory.closePurchaseOrderSchema>): Promise<inventory.PurchaseOrder> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const po = await this.poRow(tx, id, true);
      if (po.status !== 'partially_received') throw conflict('invalid_status', `${po.number} is ${po.status}; only partly received POs can be closed`);
      const [row] = await tx
        .update(inventoryPurchaseOrders)
        .set({ status: 'closed', closedReason: input.reason, updatedBy: ctx.userId })
        .where(eq(inventoryPurchaseOrders.id, id))
        .returning();
      return poDto(row!, await this.poLines(tx, id));
    });
  }

  private async writeLines(
    tx: Tx,
    poId: string,
    lines: z.output<typeof inventory.createPurchaseOrderSchema>['lines'],
    items: Map<string, pharmacy.Item>,
  ): Promise<{ po: PoRow; lines: PoLineRow[] }> {
    const tenantId = currentContext()!.tenantId!;
    let subtotal = 0;
    let taxTotal = 0;
    const values = lines.map((l, i) => {
      const item = items.get(l.itemId)!;
      const gstRate = l.gstRate ?? item.gstRate;
      const amounts = purchaseLine(toPaise(l.rate), l.qty, gstRate);
      subtotal += amounts.base;
      taxTotal += amounts.tax;
      return {
        tenantId,
        purchaseOrderId: poId,
        lineNo: i + 1,
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        unit: item.unit,
        qty: l.qty,
        rate: toRupees(toPaise(l.rate)),
        gstRate: String(gstRate),
        taxAmount: toRupees(amounts.tax),
        amount: toRupees(amounts.amount),
      };
    });
    const inserted = await tx.insert(inventoryPurchaseOrderLines).values(values).returning();
    const [po] = await tx
      .update(inventoryPurchaseOrders)
      .set({ subtotal: toRupees(subtotal), taxTotal: toRupees(taxTotal), total: toRupees(subtotal + taxTotal) })
      .where(eq(inventoryPurchaseOrders.id, poId))
      .returning();
    return { po: po!, lines: inserted.sort((a, b) => a.lineNo - b.lineNo) };
  }

  private async activeVendor(tx: Tx, id: string) {
    const [vendor] = await tx.select().from(inventoryVendors).where(eq(inventoryVendors.id, id)).limit(1);
    if (!vendor) throw badRequest('unknown_vendor', 'Vendor does not exist');
    if (!vendor.isActive) throw conflict('vendor_inactive', `${vendor.name} is inactive`);
    return vendor;
  }

  private async poRow(tx: Tx, id: string, forUpdate = false): Promise<PoRow> {
    const q = tx.select().from(inventoryPurchaseOrders).where(eq(inventoryPurchaseOrders.id, id)).limit(1);
    const [row] = forUpdate ? await q.for('update') : await q;
    if (!row) throw notFound('Purchase order');
    assertFacility(row.facilityId);
    return row;
  }

  private poLines(tx: Tx, poId: string): Promise<PoLineRow[]> {
    return tx.select().from(inventoryPurchaseOrderLines).where(eq(inventoryPurchaseOrderLines.purchaseOrderId, poId)).orderBy(asc(inventoryPurchaseOrderLines.lineNo));
  }

  // ---------- goods receipts ----------

  listGrns(q: z.output<typeof inventory.grnQuerySchema>): Promise<Paginated<inventory.Grn>> {
    return this.db.tx(async (tx) => {
      const facilities = visibleFacilities();
      const where = and(
        q.purchaseOrderId ? eq(inventoryGrns.purchaseOrderId, q.purchaseOrderId) : undefined,
        facilities ? inArray(inventoryGrns.facilityId, facilities) : undefined,
      );
      const [rows, [{ total }]] = await Promise.all([
        tx
          .select({ grn: inventoryGrns, poNumber: inventoryPurchaseOrders.number })
          .from(inventoryGrns)
          .innerJoin(inventoryPurchaseOrders, and(eq(inventoryPurchaseOrders.tenantId, inventoryGrns.tenantId), eq(inventoryPurchaseOrders.id, inventoryGrns.purchaseOrderId)))
          .where(where)
          .orderBy(desc(inventoryGrns.createdAt))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        tx.select({ total: count() }).from(inventoryGrns).where(where),
      ]);
      return { items: rows.map((r) => ({ ...grnDto(r.grn), poNumber: r.poNumber })), page: q.page, pageSize: q.pageSize, total };
    });
  }

  getGrn(id: string): Promise<inventory.Grn> {
    return this.db.tx(async (tx) => {
      const grn = await this.grnRow(tx, id);
      const [po] = await tx.select({ number: inventoryPurchaseOrders.number }).from(inventoryPurchaseOrders).where(eq(inventoryPurchaseOrders.id, grn.purchaseOrderId));
      const lines = await tx.select().from(inventoryGrnLines).where(eq(inventoryGrnLines.grnId, id)).orderBy(asc(inventoryGrnLines.id));
      const returns = await tx.select().from(inventoryPurchaseReturns).where(eq(inventoryPurchaseReturns.grnId, id)).orderBy(asc(inventoryPurchaseReturns.createdAt));
      const returnLines = returns.length
        ? await tx.select().from(inventoryPurchaseReturnLines).where(inArray(inventoryPurchaseReturnLines.purchaseReturnId, returns.map((r) => r.id)))
        : [];
      return {
        ...grnDto(grn, lines),
        poNumber: po?.number,
        returns: returns.map((r) => returnDto(r, returnLines.filter((l) => l.purchaseReturnId === r.id))),
      };
    });
  }

  /**
   * Receive goods against an approved PO into its store. Never more than is still pending on a line
   * (free goods are extra). Stock goes in through PharmacyService as a 'grn' movement.
   */
  createGrn(input: z.output<typeof inventory.createGrnSchema>): Promise<inventory.Grn> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const po = await this.poRow(tx, input.purchaseOrderId, true);
      if (!RECEIVABLE.includes(po.status as inventory.PoStatus)) throw conflict('po_not_receivable', `${po.number} is ${po.status}`);
      const poLines = new Map((await this.poLines(tx, po.id)).map((l) => [l.id, l]));

      const asked = new Map<string, number>();
      for (const l of input.lines) {
        const line = poLines.get(l.poLineId);
        if (!line) throw badRequest('unknown_po_line', 'A line does not belong to this purchase order');
        const total = (asked.get(line.id) ?? 0) + l.qty;
        asked.set(line.id, total);
        const pending = line.qty - line.receivedQty;
        if (total > pending) {
          throw conflict('over_receipt', `${line.itemName}: only ${pending} ${line.unit} pending on ${po.number}, got ${total}`);
        }
      }

      const number = formatSeries('GR', await nextCounter(tx, 'inventory.grn'));
      const [grn] = await tx
        .insert(inventoryGrns)
        .values({
          tenantId: ctx.tenantId!,
          number,
          purchaseOrderId: po.id,
          facilityId: po.facilityId,
          storeId: po.storeId,
          vendorId: po.vendorId,
          vendorName: po.vendorName,
          invoiceNo: input.invoiceNo ?? null,
          invoiceDate: input.invoiceDate ?? null,
          notes: input.notes ?? null,
          createdBy: ctx.userId,
        })
        .returning();

      let total = 0;
      for (const l of input.lines) {
        const line = poLines.get(l.poLineId)!;
        const gstRate = num(line.gstRate);
        const ratePaise = toPaise(line.rate);
        const amounts = purchaseLine(ratePaise, l.qty, gstRate);
        total += amounts.amount;
        const batchNo = (l.batchNo ?? NO_BATCH).toUpperCase();
        const expiryDate = l.expiryDate ?? NO_EXPIRY;
        const mrp = l.mrp ?? Math.round(ratePaise * (1 + gstRate / 100)) / 100;
        const { batchId } = await this.stock.receive(tx, {
          storeId: po.storeId,
          itemId: line.itemId,
          batchNo,
          expiryDate,
          mrp,
          purchaseRate: num(line.rate),
          qty: l.qty + l.freeQty,
          txnType: 'grn',
          refType: 'inventory.grn',
          refId: grn!.id,
          note: `${number} against ${po.number} from ${po.vendorName}`,
        });
        await tx.insert(inventoryGrnLines).values({
          tenantId: ctx.tenantId!,
          grnId: grn!.id,
          poLineId: line.id,
          itemId: line.itemId,
          itemName: line.itemName,
          batchId,
          batchNo,
          expiryDate,
          qty: l.qty,
          freeQty: l.freeQty,
          rate: line.rate,
          gstRate: line.gstRate,
          mrp: toRupees(toPaise(mrp)),
          amount: toRupees(amounts.amount),
        });
        line.receivedQty += l.qty;
        await tx
          .update(inventoryPurchaseOrderLines)
          .set({ receivedQty: sql`${inventoryPurchaseOrderLines.receivedQty} + ${l.qty}` })
          .where(eq(inventoryPurchaseOrderLines.id, line.id));
      }

      const fullyReceived = [...poLines.values()].every((l) => l.receivedQty >= l.qty);
      await tx
        .update(inventoryPurchaseOrders)
        .set({ status: fullyReceived ? 'received' : 'partially_received', updatedBy: ctx.userId })
        .where(eq(inventoryPurchaseOrders.id, po.id));
      const [done] = await tx.update(inventoryGrns).set({ total: toRupees(total) }).where(eq(inventoryGrns.id, grn!.id)).returning();

      const event: inventory.InventoryGrnPostedEvent = {
        grnId: grn!.id,
        number,
        purchaseOrderId: po.id,
        vendorId: po.vendorId,
        storeId: po.storeId,
        invoiceNo: input.invoiceNo ?? null,
        total: total / 100,
      };
      await this.outbox.publish(tx, 'inventory.grn.posted', { ...event });
      const lines = await tx.select().from(inventoryGrnLines).where(eq(inventoryGrnLines.grnId, grn!.id));
      return { ...grnDto(done!, lines), poNumber: po.number };
    });
  }

  /** Send goods from a GRN back to the vendor. Stock leaves the store as a 'purchase_return' movement. */
  createReturn(grnId: string, input: z.output<typeof inventory.createPurchaseReturnSchema>): Promise<inventory.PurchaseReturn> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const grn = await this.grnRow(tx, grnId, true);
      const lines = new Map((await tx.select().from(inventoryGrnLines).where(eq(inventoryGrnLines.grnId, grnId))).map((l) => [l.id, l]));
      const asked = new Map<string, number>();
      for (const l of input.lines) {
        const line = lines.get(l.grnLineId);
        if (!line) throw badRequest('unknown_grn_line', 'A line does not belong to this GRN');
        const total = (asked.get(line.id) ?? 0) + l.qty;
        asked.set(line.id, total);
        const returnable = line.qty + line.freeQty - line.returnedQty;
        if (total > returnable) throw conflict('over_return', `${line.itemName}: only ${returnable} can still be returned`);
      }

      const number = formatSeries('PRT', await nextCounter(tx, 'inventory.purchase_return'));
      const [ret] = await tx
        .insert(inventoryPurchaseReturns)
        .values({ tenantId: ctx.tenantId!, number, grnId, storeId: grn.storeId, vendorId: grn.vendorId, reason: input.reason, createdBy: ctx.userId })
        .returning();
      let total = 0;
      const out: (typeof inventoryPurchaseReturnLines.$inferSelect)[] = [];
      for (const l of input.lines) {
        const line = lines.get(l.grnLineId)!;
        await this.stock.issue(tx, {
          storeId: grn.storeId,
          itemId: line.itemId,
          batchId: line.batchId,
          qty: l.qty,
          txnType: 'purchase_return',
          refType: 'inventory.purchase_return',
          refId: ret!.id,
          note: `${number}: ${input.reason}`,
        });
        const amount = purchaseLine(toPaise(line.rate), l.qty, num(line.gstRate)).amount;
        total += amount;
        const [row] = await tx
          .insert(inventoryPurchaseReturnLines)
          .values({ tenantId: ctx.tenantId!, purchaseReturnId: ret!.id, grnLineId: line.id, itemId: line.itemId, batchId: line.batchId, qty: l.qty, amount: toRupees(amount) })
          .returning();
        out.push(row!);
        await tx
          .update(inventoryGrnLines)
          .set({ returnedQty: sql`${inventoryGrnLines.returnedQty} + ${l.qty}` })
          .where(eq(inventoryGrnLines.id, line.id));
      }
      const [done] = await tx.update(inventoryPurchaseReturns).set({ total: toRupees(total) }).where(eq(inventoryPurchaseReturns.id, ret!.id)).returning();
      return returnDto(done!, out);
    });
  }

  private async grnRow(tx: Tx, id: string, forUpdate = false): Promise<GrnRow> {
    const q = tx.select().from(inventoryGrns).where(eq(inventoryGrns.id, id)).limit(1);
    const [row] = forUpdate ? await q.for('update') : await q;
    if (!row) throw notFound('GRN');
    assertFacility(row.facilityId);
    return row;
  }
}

// ---------- DTOs ----------

function reqDto(r: ReqRow, lines?: ReqLineRow[]): inventory.Requisition {
  return {
    id: r.id,
    number: r.number,
    facilityId: r.facilityId,
    storeId: r.storeId,
    storeName: r.storeName,
    status: r.status as inventory.RequisitionStatus,
    neededBy: r.neededBy,
    notes: r.notes,
    decisionNote: r.decisionNote,
    decidedAt: iso(r.decidedAt),
    createdAt: iso(r.createdAt),
    ...(lines
      ? { lines: lines.map((l) => ({ id: l.id, lineNo: l.lineNo, itemId: l.itemId, itemCode: l.itemCode, itemName: l.itemName, unit: l.unit, qty: l.qty, note: l.note })) }
      : {}),
  };
}

function poDto(r: PoRow, lines?: PoLineRow[]): inventory.PurchaseOrder {
  return {
    id: r.id,
    number: r.number,
    facilityId: r.facilityId,
    storeId: r.storeId,
    storeName: r.storeName,
    vendorId: r.vendorId,
    vendorName: r.vendorName,
    requisitionId: r.requisitionId,
    status: r.status as inventory.PoStatus,
    expectedDate: r.expectedDate,
    terms: r.terms,
    notes: r.notes,
    subtotal: num(r.subtotal),
    taxTotal: num(r.taxTotal),
    total: num(r.total),
    approvedAt: iso(r.approvedAt),
    closedReason: r.closedReason,
    createdAt: iso(r.createdAt),
    ...(lines
      ? {
          lines: lines.map((l) => ({
            id: l.id,
            lineNo: l.lineNo,
            itemId: l.itemId,
            itemCode: l.itemCode,
            itemName: l.itemName,
            unit: l.unit,
            qty: l.qty,
            receivedQty: l.receivedQty,
            pendingQty: Math.max(0, l.qty - l.receivedQty),
            rate: num(l.rate),
            gstRate: num(l.gstRate),
            taxAmount: num(l.taxAmount),
            amount: num(l.amount),
          })),
        }
      : {}),
  };
}

function grnDto(r: GrnRow, lines?: GrnLineRow[]): inventory.Grn {
  return {
    id: r.id,
    number: r.number,
    purchaseOrderId: r.purchaseOrderId,
    storeId: r.storeId,
    vendorId: r.vendorId,
    vendorName: r.vendorName,
    invoiceNo: r.invoiceNo,
    invoiceDate: r.invoiceDate,
    total: num(r.total),
    notes: r.notes,
    createdAt: iso(r.createdAt),
    ...(lines
      ? {
          lines: lines.map((l) => ({
            id: l.id,
            poLineId: l.poLineId,
            itemId: l.itemId,
            itemName: l.itemName,
            batchId: l.batchId,
            batchNo: l.batchNo,
            expiryDate: l.expiryDate,
            qty: l.qty,
            freeQty: l.freeQty,
            returnedQty: l.returnedQty,
            rate: num(l.rate),
            gstRate: num(l.gstRate),
            mrp: num(l.mrp),
            amount: num(l.amount),
          })),
        }
      : {}),
  };
}

function returnDto(r: typeof inventoryPurchaseReturns.$inferSelect, lines: (typeof inventoryPurchaseReturnLines.$inferSelect)[]): inventory.PurchaseReturn {
  return {
    id: r.id,
    number: r.number,
    grnId: r.grnId,
    storeId: r.storeId,
    vendorId: r.vendorId,
    reason: r.reason,
    total: num(r.total),
    createdAt: iso(r.createdAt),
    lines: lines.map((l) => ({ id: l.id, grnLineId: l.grnLineId, itemId: l.itemId, batchId: l.batchId, qty: l.qty, amount: num(l.amount) })),
  };
}
