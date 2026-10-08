import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  formatSeries,
  inArray,
  inventoryIndentLines,
  inventoryIndents,
  inventoryIssueLines,
  inventoryIssues,
  iso,
  nextCounter,
  or,
  sql,
  type Tx,
} from '@hms/db';
import type { inventory, Paginated } from '@hms/shared';
import type { z } from 'zod';
import { DbService } from '../../common/db/db.service';
import { currentContext } from '../../common/context/request-context';
import { OutboxService } from '../../common/events/outbox.service';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { num } from './money';
import { InventoryStockGateway, assertFacility, visibleFacilities } from './stock.gateway';

type IndentRow = typeof inventoryIndents.$inferSelect;
type IndentLineRow = typeof inventoryIndentLines.$inferSelect;
type IssueRow = typeof inventoryIssues.$inferSelect;
type IssueLineRow = typeof inventoryIssueLines.$inferSelect;

const ISSUABLE: inventory.IndentStatus[] = ['approved', 'partially_issued'];

/** Department indents: a ward / OT / pharmacy store asks the central store, which approves and issues stock. */
@Injectable()
export class InventoryIndentsService {
  constructor(
    private readonly db: DbService,
    private readonly stock: InventoryStockGateway,
    private readonly outbox: OutboxService,
  ) {}

  list(q: z.output<typeof inventory.indentQuerySchema>): Promise<Paginated<inventory.Indent>> {
    return this.db.tx(async (tx) => {
      const facilities = visibleFacilities();
      const where = and(
        q.status ? eq(inventoryIndents.status, q.status) : undefined,
        q.pending ? inArray(inventoryIndents.status, ISSUABLE) : undefined,
        q.storeId ? or(eq(inventoryIndents.toStoreId, q.storeId), eq(inventoryIndents.fromStoreId, q.storeId)) : undefined,
        facilities ? inArray(inventoryIndents.facilityId, facilities) : undefined,
      );
      const [rows, [{ total }]] = await Promise.all([
        tx
          .select()
          .from(inventoryIndents)
          .where(where)
          .orderBy(sql`case when ${inventoryIndents.priority} = 'urgent' and ${inventoryIndents.status} in ('submitted', 'approved', 'partially_issued') then 0 else 1 end`, desc(inventoryIndents.createdAt))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        tx.select({ total: count() }).from(inventoryIndents).where(where),
      ]);
      return { items: rows.map((r) => indentDto(r)), page: q.page, pageSize: q.pageSize, total };
    });
  }

  get(id: string): Promise<inventory.Indent> {
    return this.db.tx(async (tx) => {
      await this.row(tx, id);
      return this.full(tx, id);
    });
  }

  async create(input: z.output<typeof inventory.createIndentSchema>): Promise<inventory.Indent> {
    const ctx = currentContext()!;
    if (input.toStoreId === input.fromStoreId) throw badRequest('same_store', 'The asking store and the supplying store must differ');
    const items = await this.stock.items(input.lines.map((l) => l.itemId));
    return this.db.tx(async (tx) => {
      const to = await this.stock.storeForUse(tx, input.toStoreId);
      const from = await this.stock.store(tx, input.fromStoreId);
      if (!from.isActive) throw badRequest('store_inactive', `Store ${from.name} is inactive`);
      const number = formatSeries('IND', await nextCounter(tx, 'inventory.indent'));
      const [row] = await tx
        .insert(inventoryIndents)
        .values({
          tenantId: ctx.tenantId!,
          number,
          facilityId: to.facilityId,
          toStoreId: to.id,
          toStoreName: to.name,
          fromStoreId: from.id,
          fromStoreName: from.name,
          priority: input.priority,
          notes: input.notes ?? null,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning();
      await tx.insert(inventoryIndentLines).values(
        input.lines.map((l, i) => {
          const item = items.get(l.itemId)!;
          return {
            tenantId: ctx.tenantId!,
            indentId: row!.id,
            lineNo: i + 1,
            itemId: item.id,
            itemCode: item.code,
            itemName: item.name,
            unit: item.unit,
            requestedQty: l.qty,
            note: l.note ?? null,
          };
        }),
      );
      return this.full(tx, row!.id);
    });
  }

  decide(id: string, input: z.output<typeof inventory.decideIndentSchema>): Promise<inventory.Indent> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const indent = await this.row(tx, id, true);
      if (indent.status !== 'submitted') throw conflict('invalid_status', `Indent ${indent.number} is ${indent.status}`);
      const lines = await this.lines(tx, id);
      if (input.approve) {
        const cut = new Map((input.lines ?? []).map((l) => [l.indentLineId, l.approvedQty]));
        for (const lineId of cut.keys()) {
          if (!lines.some((l) => l.id === lineId)) throw badRequest('unknown_indent_line', 'A line does not belong to this indent');
        }
        for (const l of lines) {
          const approvedQty = cut.get(l.id) ?? l.requestedQty;
          if (approvedQty > l.requestedQty) throw badRequest('approved_above_requested', `${l.itemName}: cannot approve more than the ${l.requestedQty} asked for`);
          await tx.update(inventoryIndentLines).set({ approvedQty }).where(eq(inventoryIndentLines.id, l.id));
        }
      }
      await tx
        .update(inventoryIndents)
        .set({ status: input.approve ? 'approved' : 'rejected', decidedBy: ctx.userId, decidedAt: sql`now()`, decisionNote: input.note ?? null, updatedBy: ctx.userId })
        .where(eq(inventoryIndents.id, id));
      return this.full(tx, id);
    });
  }

  async update(id: string, input: z.output<typeof inventory.updateIndentSchema>): Promise<inventory.Indent> {
    const ctx = currentContext()!;
    const items = input.lines ? await this.stock.items(input.lines.map((l) => l.itemId)) : null;
    return this.db.tx(async (tx) => {
      const indent = await this.row(tx, id, true);
      if (indent.status !== 'submitted') throw conflict('invalid_status', `Indent ${indent.number} is ${indent.status}; only unapproved indents can be edited`);
      const patch: Partial<typeof inventoryIndents.$inferInsert> = { updatedBy: ctx.userId };
      if (input.priority !== undefined) patch.priority = input.priority;
      if (input.notes !== undefined) patch.notes = input.notes || null;
      await tx.update(inventoryIndents).set(patch).where(eq(inventoryIndents.id, id));
      if (input.lines && items) {
        await tx.delete(inventoryIndentLines).where(eq(inventoryIndentLines.indentId, id));
        await tx.insert(inventoryIndentLines).values(
          input.lines.map((l, i) => {
            const item = items.get(l.itemId)!;
            return {
              tenantId: ctx.tenantId!,
              indentId: id,
              lineNo: i + 1,
              itemId: item.id,
              itemCode: item.code,
              itemName: item.name,
              unit: item.unit,
              requestedQty: l.qty,
              note: l.note ?? null,
            };
          }),
        );
      }
      return this.full(tx, id);
    });
  }

  cancel(id: string): Promise<inventory.Indent> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const indent = await this.row(tx, id, true);
      if (indent.status !== 'submitted') throw conflict('invalid_status', `Indent ${indent.number} is ${indent.status}; only unapproved indents can be cancelled`);
      await tx.update(inventoryIndents).set({ status: 'cancelled', updatedBy: ctx.userId }).where(eq(inventoryIndents.id, id));
      return this.full(tx, id);
    });
  }

  /** Stop issuing the rest of an approved indent. */
  close(id: string, input: z.output<typeof inventory.closeIndentSchema>): Promise<inventory.Indent> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const indent = await this.row(tx, id, true);
      if (!ISSUABLE.includes(indent.status as inventory.IndentStatus)) throw conflict('invalid_status', `Indent ${indent.number} is ${indent.status}`);
      await tx.update(inventoryIndents).set({ status: 'closed', decisionNote: input.reason, updatedBy: ctx.userId }).where(eq(inventoryIndents.id, id));
      return this.full(tx, id);
    });
  }

  /**
   * Move stock from the supplying store to the asking store: a 'transfer_out' FEFO (or from the chosen batch)
   * and a matching 'transfer_in' of the same batches, all through PharmacyService in one transaction.
   */
  issue(id: string, input: z.output<typeof inventory.issueIndentSchema>): Promise<inventory.Indent> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const indent = await this.row(tx, id, true, false);
      if (!ISSUABLE.includes(indent.status as inventory.IndentStatus)) throw conflict('indent_not_issuable', `Indent ${indent.number} is ${indent.status}`);
      const lines = new Map((await this.lines(tx, id)).map((l) => [l.id, l]));
      const asked = new Map<string, number>();
      for (const l of input.lines) {
        const line = lines.get(l.indentLineId);
        if (!line) throw badRequest('unknown_indent_line', 'A line does not belong to this indent');
        const total = (asked.get(line.id) ?? 0) + l.qty;
        asked.set(line.id, total);
        const pending = (line.approvedQty ?? line.requestedQty) - line.issuedQty;
        if (total > pending) throw conflict('over_issue', `${line.itemName}: only ${pending} ${line.unit} pending on ${indent.number}`);
      }

      const number = formatSeries('ISS', await nextCounter(tx, 'inventory.issue'));
      const [issue] = await tx
        .insert(inventoryIssues)
        .values({ tenantId: ctx.tenantId!, number, indentId: id, fromStoreId: indent.fromStoreId, toStoreId: indent.toStoreId, notes: input.notes ?? null, createdBy: ctx.userId })
        .returning();
      const moved: inventory.InventoryIndentIssuedEvent['lines'] = [];
      for (const l of input.lines) {
        const line = lines.get(l.indentLineId)!;
        const ref = { refType: 'inventory.issue', refId: issue!.id, note: `${number} for ${indent.number}` };
        const allocations = await this.stock.issue(tx, {
          storeId: indent.fromStoreId,
          itemId: line.itemId,
          qty: l.qty,
          batchId: l.batchId,
          txnType: 'transfer_out',
          ...ref,
        });
        for (const a of allocations) {
          await this.stock.receive(tx, {
            storeId: indent.toStoreId,
            itemId: line.itemId,
            batchNo: a.batch.batchNo,
            expiryDate: a.batch.expiryDate,
            mrp: num(a.batch.mrp),
            purchaseRate: num(a.batch.purchaseRate),
            saleRate: num(a.batch.saleRate),
            qty: a.qty,
            txnType: 'transfer_in',
            ...ref,
          });
          await tx.insert(inventoryIssueLines).values({
            tenantId: ctx.tenantId!,
            issueId: issue!.id,
            indentLineId: line.id,
            itemId: line.itemId,
            batchId: a.batch.id,
            batchNo: a.batch.batchNo,
            expiryDate: a.batch.expiryDate,
            qty: a.qty,
          });
          moved.push({ itemId: line.itemId, batchId: a.batch.id, qty: a.qty });
        }
        line.issuedQty += l.qty;
        await tx
          .update(inventoryIndentLines)
          .set({ issuedQty: sql`${inventoryIndentLines.issuedQty} + ${l.qty}` })
          .where(eq(inventoryIndentLines.id, line.id));
      }
      const complete = [...lines.values()].every((l) => l.issuedQty >= (l.approvedQty ?? l.requestedQty));
      await tx
        .update(inventoryIndents)
        .set({ status: complete ? 'issued' : 'partially_issued', updatedBy: ctx.userId })
        .where(eq(inventoryIndents.id, id));

      const event: inventory.InventoryIndentIssuedEvent = { indentId: id, issueId: issue!.id, fromStoreId: indent.fromStoreId, toStoreId: indent.toStoreId, lines: moved };
      await this.outbox.publish(tx, 'inventory.indent.issued', { ...event });
      return this.full(tx, id);
    });
  }

  /**
   * Indents are visible to the asking store's facility. The supplying store (often another facility's main
   * store) can see and issue them too, so the issue path checks the supplying store's facility instead;
   * PharmacyService also checks it when the stock moves.
   */
  private async row(tx: Tx, id: string, forUpdate = false, askingSide = true): Promise<IndentRow> {
    const q = tx.select().from(inventoryIndents).where(eq(inventoryIndents.id, id)).limit(1);
    const [row] = forUpdate ? await q.for('update') : await q;
    if (!row) throw notFound('Indent');
    if (askingSide) assertFacility(row.facilityId);
    return row;
  }

  private lines(tx: Tx, indentId: string): Promise<IndentLineRow[]> {
    return tx.select().from(inventoryIndentLines).where(eq(inventoryIndentLines.indentId, indentId)).orderBy(asc(inventoryIndentLines.lineNo));
  }

  /** Loads the indent with lines and issues; callers check access first. */
  private async full(tx: Tx, id: string): Promise<inventory.Indent> {
    const row = await this.row(tx, id, false, false);
    const [lines, issues] = await Promise.all([
      this.lines(tx, id),
      tx.select().from(inventoryIssues).where(eq(inventoryIssues.indentId, id)).orderBy(asc(inventoryIssues.createdAt)),
    ]);
    const issueLines = issues.length ? await tx.select().from(inventoryIssueLines).where(inArray(inventoryIssueLines.issueId, issues.map((i) => i.id))) : [];
    return indentDto(row, lines, issues.map((i) => issueDto(i, issueLines.filter((l) => l.issueId === i.id))));
  }
}

function indentDto(r: IndentRow, lines?: IndentLineRow[], issues?: inventory.Issue[]): inventory.Indent {
  return {
    id: r.id,
    number: r.number,
    facilityId: r.facilityId,
    toStoreId: r.toStoreId,
    toStoreName: r.toStoreName,
    fromStoreId: r.fromStoreId,
    fromStoreName: r.fromStoreName,
    priority: r.priority as inventory.Indent['priority'],
    status: r.status as inventory.IndentStatus,
    notes: r.notes,
    decisionNote: r.decisionNote,
    decidedAt: iso(r.decidedAt),
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
            requestedQty: l.requestedQty,
            approvedQty: l.approvedQty,
            issuedQty: l.issuedQty,
            pendingQty: Math.max(0, (l.approvedQty ?? l.requestedQty) - l.issuedQty),
            note: l.note,
          })),
        }
      : {}),
    ...(issues ? { issues } : {}),
  };
}

function issueDto(r: IssueRow, lines: IssueLineRow[]): inventory.Issue {
  return {
    id: r.id,
    number: r.number,
    indentId: r.indentId,
    fromStoreId: r.fromStoreId,
    toStoreId: r.toStoreId,
    notes: r.notes,
    createdAt: iso(r.createdAt),
    lines: lines.map((l) => ({ id: l.id, indentLineId: l.indentLineId, itemId: l.itemId, batchId: l.batchId, batchNo: l.batchNo, expiryDate: l.expiryDate, qty: l.qty })),
  };
}
