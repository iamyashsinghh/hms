import { HttpStatus, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  formatSeries,
  iso,
  nextCounter,
  pharmacyBatches,
  pharmacyGrnLines,
  pharmacyGrns,
  pharmacyItems,
  pharmacyStockBalances,
  pharmacyStockLedger,
  pharmacyStores,
  sql,
  type Tx,
} from '@hms/db';
import type { pharmacy } from '@hms/shared';
import type { z } from 'zod';
import { DbService } from '../../common/db/db.service';
import { OutboxService } from '../../common/events/outbox.service';
import { currentContext } from '../../common/context/request-context';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../common/errors/errors';
import { num, toPaise, toRupees } from './money';

type LedgerType = (typeof pharmacy.LEDGER_TYPES)[number];
type StoreRow = typeof pharmacyStores.$inferSelect;
type BatchRow = typeof pharmacyBatches.$inferSelect;

export interface IncomingBatch {
  itemId: string;
  batchNo: string;
  expiryDate: string;
  mrp: number;
  purchaseRate?: number;
  saleRate?: number;
}

export interface Movement {
  storeId: string;
  itemId: string;
  batchId: string;
  qty: number;
  txnType: LedgerType;
  refType?: string;
  refId?: string;
  note?: string;
}

export interface Allocation {
  batch: BatchRow;
  qty: number;
}

/**
 * Stock core: batches, balances and the append-only ledger. Every movement goes through stockIn/stockOut so
 * the balance and ledger always agree and stock never goes negative. Other modules (inventory, ipd) move stock
 * through PharmacyService, which wraps this.
 */
@Injectable()
export class PharmacyStockService {
  constructor(
    private readonly db: DbService,
    private readonly outbox: OutboxService,
  ) {}

  // ---------- building blocks (call inside a tx) ----------

  /** Loads a store and checks the caller may work in its facility. */
  async storeForWrite(tx: Tx, storeId: string): Promise<StoreRow> {
    const [store] = await tx.select().from(pharmacyStores).where(eq(pharmacyStores.id, storeId)).limit(1);
    if (!store) throw notFound('Store');
    if (!store.isActive) throw badRequest('store_inactive', `Store ${store.name} is inactive`);
    const ctx = currentContext();
    if (ctx && ctx.facilityIds !== 'all' && !ctx.facilityIds.includes(store.facilityId)) {
      throw forbidden('You do not work in the facility of this store');
    }
    return store;
  }

  async item(tx: Tx, itemId: string) {
    const [item] = await tx.select().from(pharmacyItems).where(eq(pharmacyItems.id, itemId)).limit(1);
    if (!item) throw notFound('Item');
    return item;
  }

  /** Finds the batch (item + batch no + expiry) or creates it. */
  async ensureBatch(tx: Tx, b: IncomingBatch): Promise<BatchRow> {
    const saleRate = b.saleRate ?? b.mrp;
    if (saleRate > b.mrp) throw badRequest('sale_rate_above_mrp', `Sale rate for batch ${b.batchNo} is above MRP`);
    const [existing] = await tx
      .select()
      .from(pharmacyBatches)
      .where(
        and(
          eq(pharmacyBatches.itemId, b.itemId),
          sql`upper(${pharmacyBatches.batchNo}) = upper(${b.batchNo})`,
          eq(pharmacyBatches.expiryDate, b.expiryDate),
        ),
      )
      .limit(1);
    if (existing) return existing;
    const [row] = await tx
      .insert(pharmacyBatches)
      .values({
        tenantId: currentTenant(),
        itemId: b.itemId,
        batchNo: b.batchNo.toUpperCase(),
        expiryDate: b.expiryDate,
        mrp: toRupees(toPaise(b.mrp)),
        purchaseRate: toRupees(toPaise(b.purchaseRate ?? 0)),
        saleRate: toRupees(toPaise(saleRate)),
      })
      .returning();
    return row!;
  }

  async stockIn(tx: Tx, m: Movement): Promise<number> {
    if (m.qty <= 0) throw badRequest('invalid_qty', 'Quantity must be positive');
    const [bal] = await tx
      .insert(pharmacyStockBalances)
      .values({ tenantId: currentTenant(), storeId: m.storeId, itemId: m.itemId, batchId: m.batchId, qty: m.qty })
      .onConflictDoUpdate({
        target: [pharmacyStockBalances.tenantId, pharmacyStockBalances.storeId, pharmacyStockBalances.batchId],
        set: { qty: sql`${pharmacyStockBalances.qty} + ${m.qty}` },
      })
      .returning({ qty: pharmacyStockBalances.qty });
    await this.ledger(tx, m, m.qty, bal!.qty);
    return bal!.qty;
  }

  /** Removes stock from one batch; fails with 409 insufficient_stock rather than going negative. */
  async stockOut(tx: Tx, m: Movement): Promise<number> {
    if (m.qty <= 0) throw badRequest('invalid_qty', 'Quantity must be positive');
    const [bal] = await tx
      .update(pharmacyStockBalances)
      .set({ qty: sql`${pharmacyStockBalances.qty} - ${m.qty}` })
      .where(
        and(
          eq(pharmacyStockBalances.storeId, m.storeId),
          eq(pharmacyStockBalances.batchId, m.batchId),
          sql`${pharmacyStockBalances.qty} >= ${m.qty}`,
        ),
      )
      .returning({ qty: pharmacyStockBalances.qty });
    if (!bal) throw conflict('insufficient_stock', 'Not enough stock in this batch');
    await this.ledger(tx, m, -m.qty, bal.qty);
    return bal.qty;
  }

  private async ledger(tx: Tx, m: Movement, change: number, balanceAfter: number) {
    await tx.insert(pharmacyStockLedger).values({
      tenantId: currentTenant(),
      storeId: m.storeId,
      itemId: m.itemId,
      batchId: m.batchId,
      txnType: m.txnType,
      qtyChange: change,
      balanceAfter,
      refType: m.refType ?? null,
      refId: m.refId ?? null,
      note: m.note ?? null,
      createdBy: currentContext()?.userId ?? null,
    });
  }

  /**
   * Picks batches for an outgoing quantity: the given batch, or first-expiry-first-out over unexpired batches.
   * Locks the balance rows so two counters cannot sell the same units.
   */
  async allocate(tx: Tx, storeId: string, itemId: string, qty: number, batchId?: string): Promise<Allocation[]> {
    const rows = await tx
      .select({ batch: pharmacyBatches, qty: pharmacyStockBalances.qty, expired: sql<boolean>`${pharmacyBatches.expiryDate} < current_date` })
      .from(pharmacyStockBalances)
      .innerJoin(pharmacyBatches, and(eq(pharmacyBatches.tenantId, pharmacyStockBalances.tenantId), eq(pharmacyBatches.id, pharmacyStockBalances.batchId)))
      .where(
        and(
          eq(pharmacyStockBalances.storeId, storeId),
          eq(pharmacyStockBalances.itemId, itemId),
          sql`${pharmacyStockBalances.qty} > 0`,
          batchId ? eq(pharmacyStockBalances.batchId, batchId) : sql`${pharmacyBatches.expiryDate} >= current_date`,
        ),
      )
      .orderBy(asc(pharmacyBatches.expiryDate), asc(pharmacyBatches.createdAt))
      .for('update');

    if (batchId) {
      const row = rows[0];
      if (!row) throw conflict('insufficient_stock', 'This batch has no stock in the store');
      if (row.expired) throw conflict('batch_expired', `Batch ${row.batch.batchNo} expired on ${row.batch.expiryDate}`);
      if (row.qty < qty) throw insufficientStock(itemId, qty, row.qty);
      return [{ batch: row.batch, qty }];
    }

    const out: Allocation[] = [];
    let left = qty;
    for (const r of rows) {
      if (left === 0) break;
      const take = Math.min(left, r.qty);
      out.push({ batch: r.batch, qty: take });
      left -= take;
    }
    if (left > 0) throw insufficientStock(itemId, qty, qty - left);
    return out;
  }

  /** Total sellable + expired units of an item in a store. */
  async itemQty(tx: Tx, storeId: string, itemId: string): Promise<number> {
    const [r] = await tx
      .select({ qty: sql<string>`coalesce(sum(${pharmacyStockBalances.qty}), 0)` })
      .from(pharmacyStockBalances)
      .where(and(eq(pharmacyStockBalances.storeId, storeId), eq(pharmacyStockBalances.itemId, itemId)));
    return Number(r?.qty ?? 0);
  }

  /** Publishes pharmacy.stock.low when stock crosses down to the reorder level. */
  async checkLow(tx: Tx, storeId: string, itemId: string, removed: number): Promise<void> {
    const item = await this.item(tx, itemId);
    if (item.reorderLevel <= 0) return;
    const after = await this.itemQty(tx, storeId, itemId);
    if (after <= item.reorderLevel && after + removed > item.reorderLevel) {
      const payload: pharmacy.PharmacyStockLowEvent = { itemId, storeId, qty: after, reorderLevel: item.reorderLevel };
      await this.outbox.publish(tx, 'pharmacy.stock.low', { ...payload });
    }
  }

  // ---------- endpoints ----------

  openingStock(input: z.output<typeof pharmacy.openingStockSchema>): Promise<{ lines: number; units: number }> {
    return this.db.tx(async (tx) => {
      const store = await this.storeForWrite(tx, input.storeId);
      let units = 0;
      for (const l of input.lines) {
        await this.item(tx, l.itemId);
        const batch = await this.ensureBatch(tx, l);
        await this.stockIn(tx, { storeId: store.id, itemId: l.itemId, batchId: batch.id, qty: l.qty, txnType: 'opening', note: 'Opening stock' });
        units += l.qty;
      }
      return { lines: input.lines.length, units };
    });
  }

  createGrn(input: z.output<typeof pharmacy.createGrnSchema>): Promise<pharmacy.Grn> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const store = await this.storeForWrite(tx, input.storeId);
      const number = formatSeries('GRN', await nextCounter(tx, 'pharmacy.grn'));
      const [grn] = await tx
        .insert(pharmacyGrns)
        .values({
          tenantId: ctx.tenantId!,
          number,
          storeId: store.id,
          supplierName: input.supplierName,
          supplierGstin: input.supplierGstin ?? null,
          invoiceNo: input.invoiceNo ?? null,
          invoiceDate: input.invoiceDate ?? null,
          notes: input.notes ?? null,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning();
      let total = 0;
      for (const l of input.lines) {
        const item = await this.item(tx, l.itemId);
        const batch = await this.ensureBatch(tx, l);
        const gstRate = l.gstRate ?? num(item.gstRate);
        // Purchase rate is GST-exclusive on supplier invoices; line amount includes GST.
        const base = toPaise(l.purchaseRate) * l.qty;
        const amount = base + Math.round((base * gstRate) / 100);
        total += amount;
        await tx.insert(pharmacyGrnLines).values({
          tenantId: ctx.tenantId!,
          grnId: grn!.id,
          itemId: l.itemId,
          batchId: batch.id,
          qty: l.qty,
          freeQty: l.freeQty,
          purchaseRate: toRupees(toPaise(l.purchaseRate)),
          mrp: toRupees(toPaise(l.mrp)),
          gstRate: String(gstRate),
          amount: toRupees(amount),
        });
        await this.stockIn(tx, {
          storeId: store.id,
          itemId: l.itemId,
          batchId: batch.id,
          qty: l.qty + l.freeQty,
          txnType: 'grn',
          refType: 'grn',
          refId: grn!.id,
          note: `${number} from ${input.supplierName}`,
        });
      }
      const [done] = await tx.update(pharmacyGrns).set({ totalAmount: toRupees(total) }).where(eq(pharmacyGrns.id, grn!.id)).returning();
      return grnDto(done!);
    });
  }

  listGrns(page: number, pageSize: number): Promise<{ items: pharmacy.Grn[]; page: number; pageSize: number; total: number }> {
    return this.db.tx(async (tx) => {
      const [items, [{ total }]] = await Promise.all([
        tx.select().from(pharmacyGrns).orderBy(desc(pharmacyGrns.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
        tx.select({ total: count() }).from(pharmacyGrns),
      ]);
      return { items: items.map(grnDto), page, pageSize, total };
    });
  }

  getGrn(id: string): Promise<pharmacy.Grn> {
    return this.db.tx(async (tx) => {
      const [grn] = await tx.select().from(pharmacyGrns).where(eq(pharmacyGrns.id, id)).limit(1);
      if (!grn) throw notFound('GRN');
      const lines = await tx
        .select({ line: pharmacyGrnLines, itemName: pharmacyItems.name, batchNo: pharmacyBatches.batchNo, expiryDate: pharmacyBatches.expiryDate })
        .from(pharmacyGrnLines)
        .innerJoin(pharmacyItems, and(eq(pharmacyItems.tenantId, pharmacyGrnLines.tenantId), eq(pharmacyItems.id, pharmacyGrnLines.itemId)))
        .innerJoin(pharmacyBatches, and(eq(pharmacyBatches.tenantId, pharmacyGrnLines.tenantId), eq(pharmacyBatches.id, pharmacyGrnLines.batchId)))
        .where(eq(pharmacyGrnLines.grnId, id));
      return {
        ...grnDto(grn),
        lines: lines.map(({ line: l, itemName, batchNo, expiryDate }) => ({
          id: l.id,
          itemId: l.itemId,
          itemName,
          batchId: l.batchId,
          batchNo,
          expiryDate,
          qty: l.qty,
          freeQty: l.freeQty,
          purchaseRate: num(l.purchaseRate),
          mrp: num(l.mrp),
          gstRate: num(l.gstRate),
          amount: num(l.amount),
        })),
      };
    });
  }

  adjust(input: z.output<typeof pharmacy.stockAdjustmentSchema>): Promise<{ batchId: string; balance: number }> {
    return this.db.tx(async (tx) => {
      const store = await this.storeForWrite(tx, input.storeId);
      const [batch] = await tx.select().from(pharmacyBatches).where(eq(pharmacyBatches.id, input.batchId)).limit(1);
      if (!batch) throw notFound('Batch');
      if (input.type === 'expiry_writeoff' && input.qtyChange > 0) {
        throw badRequest('invalid_qty', 'An expiry write-off removes stock; use a negative quantity');
      }
      const m: Movement = {
        storeId: store.id,
        itemId: batch.itemId,
        batchId: batch.id,
        qty: Math.abs(input.qtyChange),
        txnType: input.type,
        refType: 'adjustment',
        note: input.reason,
      };
      if (input.qtyChange > 0) return { batchId: batch.id, balance: await this.stockIn(tx, m) };
      const balance = await this.stockOut(tx, m);
      await this.checkLow(tx, store.id, batch.itemId, m.qty);
      return { batchId: batch.id, balance };
    });
  }

  stock(q: z.output<typeof pharmacy.stockQuerySchema>): Promise<{ items: pharmacy.StockRow[]; page: number; pageSize: number; total: number }> {
    return this.db.tx(async (tx) => {
      const term = q.q?.toLowerCase();
      const search = term
        ? sql`and (upper(i.code) = upper(${term}) or lower(i.name) like ${'%' + term + '%'} or lower(coalesce(i.generic_name, '')) like ${'%' + term + '%'})`
        : sql``;
      const base = sql`
        select i.id as item_id, i.code, i.name, i.generic_name, i.form, i.strength, i.unit, i.schedule, i.reorder_level,
               coalesce(sum(b.qty) filter (where bt.expiry_date >= current_date), 0)::int as qty,
               coalesce(sum(b.qty) filter (where bt.expiry_date < current_date), 0)::int as expired_qty,
               min(bt.expiry_date) filter (where b.qty > 0 and bt.expiry_date >= current_date) as nearest_expiry
          from inventory.items i
          left join inventory.stock_balances b on b.tenant_id = i.tenant_id and b.item_id = i.id and b.store_id = ${q.storeId}
          left join inventory.batches bt on bt.tenant_id = b.tenant_id and bt.id = b.batch_id
         where i.is_active ${search}
         group by i.id`;
      const filtered = q.lowOnly ? sql`select * from (${base}) s where s.qty <= s.reorder_level` : sql`select * from (${base}) s`;
      const [rows, totals] = await Promise.all([
        tx.execute<StockSqlRow>(sql`${filtered} order by name limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`),
        tx.execute<{ total: number }>(sql`select count(*)::int as total from (${filtered}) t`),
      ]);
      return {
        items: rows.rows.map((r) => ({
          itemId: r.item_id,
          code: r.code,
          name: r.name,
          genericName: r.generic_name,
          form: r.form,
          strength: r.strength,
          unit: r.unit,
          schedule: r.schedule,
          reorderLevel: r.reorder_level,
          qty: r.qty,
          expiredQty: r.expired_qty,
          nearestExpiry: r.nearest_expiry ? String(r.nearest_expiry).slice(0, 10) : null,
          isLow: r.qty <= r.reorder_level,
        })),
        page: q.page,
        pageSize: q.pageSize,
        total: totals.rows[0]?.total ?? 0,
      };
    });
  }

  batches(storeId: string, itemId: string): Promise<pharmacy.BatchStock[]> {
    return this.db.tx(async (tx) => {
      const rows = await tx
        .select({ batch: pharmacyBatches, qty: pharmacyStockBalances.qty })
        .from(pharmacyStockBalances)
        .innerJoin(pharmacyBatches, and(eq(pharmacyBatches.tenantId, pharmacyStockBalances.tenantId), eq(pharmacyBatches.id, pharmacyStockBalances.batchId)))
        .where(and(eq(pharmacyStockBalances.storeId, storeId), eq(pharmacyStockBalances.itemId, itemId), sql`${pharmacyStockBalances.qty} > 0`))
        .orderBy(asc(pharmacyBatches.expiryDate));
      return rows.map((r) => batchDto(r.batch, r.qty));
    });
  }

  expiring(q: z.output<typeof pharmacy.expiringQuerySchema>): Promise<pharmacy.ExpiringBatch[]> {
    return this.db.tx(async (tx) => {
      const rows = await tx
        .select({ batch: pharmacyBatches, qty: pharmacyStockBalances.qty, itemCode: pharmacyItems.code, itemName: pharmacyItems.name })
        .from(pharmacyStockBalances)
        .innerJoin(pharmacyBatches, and(eq(pharmacyBatches.tenantId, pharmacyStockBalances.tenantId), eq(pharmacyBatches.id, pharmacyStockBalances.batchId)))
        .innerJoin(pharmacyItems, and(eq(pharmacyItems.tenantId, pharmacyStockBalances.tenantId), eq(pharmacyItems.id, pharmacyStockBalances.itemId)))
        .where(
          and(
            eq(pharmacyStockBalances.storeId, q.storeId),
            sql`${pharmacyStockBalances.qty} > 0`,
            sql`${pharmacyBatches.expiryDate} <= current_date + ${q.days}::int`,
          ),
        )
        .orderBy(asc(pharmacyBatches.expiryDate))
        .limit(500);
      const now = Date.parse(today());
      return rows.map((r) => ({
        ...batchDto(r.batch, r.qty),
        itemCode: r.itemCode,
        itemName: r.itemName,
        daysToExpiry: Math.round((Date.parse(r.batch.expiryDate) - now) / 86_400_000),
      }));
    });
  }

  ledgerEntries(q: z.output<typeof pharmacy.ledgerQuerySchema>): Promise<{ items: pharmacy.LedgerEntry[]; page: number; pageSize: number; total: number }> {
    return this.db.tx(async (tx) => {
      const filter = and(
        q.storeId ? eq(pharmacyStockLedger.storeId, q.storeId) : undefined,
        q.itemId ? eq(pharmacyStockLedger.itemId, q.itemId) : undefined,
      );
      const [rows, [{ total }]] = await Promise.all([
        tx
          .select({ l: pharmacyStockLedger, itemName: pharmacyItems.name, batchNo: pharmacyBatches.batchNo })
          .from(pharmacyStockLedger)
          .innerJoin(pharmacyItems, and(eq(pharmacyItems.tenantId, pharmacyStockLedger.tenantId), eq(pharmacyItems.id, pharmacyStockLedger.itemId)))
          .innerJoin(pharmacyBatches, and(eq(pharmacyBatches.tenantId, pharmacyStockLedger.tenantId), eq(pharmacyBatches.id, pharmacyStockLedger.batchId)))
          .where(filter)
          .orderBy(desc(pharmacyStockLedger.createdAt), desc(pharmacyStockLedger.id))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        tx.select({ total: count() }).from(pharmacyStockLedger).where(filter),
      ]);
      return {
        items: rows.map(({ l, itemName, batchNo }) => ({
          id: l.id,
          storeId: l.storeId,
          itemId: l.itemId,
          itemName,
          batchId: l.batchId,
          batchNo,
          txnType: l.txnType as LedgerType,
          qtyChange: l.qtyChange,
          balanceAfter: l.balanceAfter,
          refType: l.refType,
          refId: l.refId,
          note: l.note,
          createdAt: iso(l.createdAt),
        })),
        page: q.page,
        pageSize: q.pageSize,
        total,
      };
    });
  }
}

export const insufficientStock = (itemId: string, requested: number, available: number) =>
  new AppError(HttpStatus.CONFLICT, 'insufficient_stock', `Only ${available} in stock, ${requested} requested`, { itemId, requested, available });

interface StockSqlRow extends Record<string, unknown> {
  item_id: string;
  code: string;
  name: string;
  generic_name: string | null;
  form: string;
  strength: string | null;
  unit: string;
  schedule: string;
  reorder_level: number;
  qty: number;
  expired_qty: number;
  nearest_expiry: string | null;
}

export const today = () => new Date().toISOString().slice(0, 10);

function currentTenant(): string {
  const t = currentContext()?.tenantId;
  if (!t) throw new Error('pharmacy stock: no tenant in context');
  return t;
}

export function batchDto(b: BatchRow, qty: number): pharmacy.BatchStock {
  return {
    batchId: b.id,
    itemId: b.itemId,
    batchNo: b.batchNo,
    expiryDate: b.expiryDate,
    mrp: num(b.mrp),
    saleRate: num(b.saleRate),
    purchaseRate: num(b.purchaseRate),
    qty,
    isExpired: b.expiryDate < today(),
  };
}

function grnDto(g: typeof pharmacyGrns.$inferSelect): pharmacy.Grn {
  return {
    id: g.id,
    number: g.number,
    storeId: g.storeId,
    supplierName: g.supplierName,
    supplierGstin: g.supplierGstin,
    invoiceNo: g.invoiceNo,
    invoiceDate: g.invoiceDate,
    status: g.status as pharmacy.Grn['status'],
    totalAmount: num(g.totalAmount),
    notes: g.notes,
    createdAt: iso(g.createdAt),
  };
}
