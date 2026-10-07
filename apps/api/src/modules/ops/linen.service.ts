import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, iso, opsLinenItems, opsLinenTxns, sql, type Tx } from '@hms/db';
import type { Paginated, ops as O } from '@hms/shared';
import type { z } from 'zod';
import { DbService } from '../../common/db/db.service';
import { currentContext } from '../../common/context/request-context';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { actorId, defined, facilityCond, requireFacility } from './ops.common';

type ItemRow = typeof opsLinenItems.$inferSelect;
type SQL = ReturnType<typeof sql>;
type Pool = 'clean' | 'inUse' | 'soiled' | 'atLaundry';
type Balances = Record<Pool | 'condemned', number>;

/** Which pool a movement draws from (stock_in adds new linen and draws from nothing). */
const SOURCE: Record<Exclude<O.LinenTxnKind, 'stock_in' | 'condemn'>, Pool> = {
  issue: 'clean',
  collect: 'inUse',
  laundry_out: 'soiled',
  laundry_in: 'atLaundry',
};
const POOL_LABEL: Record<Pool, string> = { clean: 'clean store', inUse: 'wards', soiled: 'soiled linen', atLaundry: 'laundry' };

/** Linen & laundry: item master and an append-only movement ledger; balances are sums over it. */
@Injectable()
export class LinenService {
  constructor(private readonly db: DbService) {}

  listItems(): Promise<O.LinenItem[]> {
    return this.db.tx(async (tx) => (await tx.select().from(opsLinenItems).orderBy(opsLinenItems.name)).map(itemDto));
  }

  createItem(input: z.output<typeof O.linenItemInputSchema>): Promise<O.LinenItem> {
    return this.db.tx(async (tx) => {
      const [dup] = await tx.select({ id: opsLinenItems.id }).from(opsLinenItems).where(sql`lower(${opsLinenItems.name}) = lower(${input.name})`);
      if (dup) throw conflict('duplicate_item', `${input.name} already exists`);
      const [row] = await tx
        .insert(opsLinenItems)
        .values({ tenantId: currentContext()!.tenantId!, name: input.name, parLevel: input.parLevel, isActive: input.isActive ?? true })
        .returning();
      return itemDto(row!);
    });
  }

  updateItem(id: string, input: Partial<z.output<typeof O.linenItemInputSchema>>): Promise<O.LinenItem> {
    return this.db.tx(async (tx) => {
      const [row] = await tx
        .update(opsLinenItems)
        .set(defined({ name: input.name, parLevel: input.parLevel, isActive: input.isActive }))
        .where(eq(opsLinenItems.id, id))
        .returning();
      if (!row) throw notFound('Linen item');
      return itemDto(row);
    });
  }

  stock(): Promise<O.LinenStock[]> {
    return this.db.tx(async (tx) => {
      const items = await tx.select().from(opsLinenItems).where(eq(opsLinenItems.isActive, true)).orderBy(opsLinenItems.name);
      const bal = await this.balances(tx, facilityCond(opsLinenTxns.facilityId));
      return items.map((i) => {
        const b = bal.get(i.id) ?? empty();
        return { itemId: i.id, name: i.name, parLevel: i.parLevel, ...b, belowPar: b.clean < i.parLevel };
      });
    });
  }

  listTxns(q: { itemId?: string; kind?: O.LinenTxnKind; page: number; pageSize: number }): Promise<Paginated<O.LinenTxn>> {
    return this.db.tx(async (tx) => {
      const conds: (SQL | undefined)[] = [facilityCond(opsLinenTxns.facilityId)];
      if (q.itemId) conds.push(eq(opsLinenTxns.itemId, q.itemId));
      if (q.kind) conds.push(eq(opsLinenTxns.kind, q.kind));
      const where = and(...conds);
      const [rows, [{ total }]] = await Promise.all([
        tx
          .select({ t: opsLinenTxns, name: opsLinenItems.name })
          .from(opsLinenTxns)
          .innerJoin(opsLinenItems, and(eq(opsLinenItems.tenantId, opsLinenTxns.tenantId), eq(opsLinenItems.id, opsLinenTxns.itemId)))
          .where(where)
          .orderBy(desc(opsLinenTxns.createdAt))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        tx.select({ total: count() }).from(opsLinenTxns).where(where),
      ]);
      return { items: rows.map((r) => txnDto(r.t, r.name)), page: q.page, pageSize: q.pageSize, total };
    });
  }

  record(input: z.output<typeof O.linenTxnInputSchema>): Promise<O.LinenTxn> {
    const facilityId = requireFacility();
    if ((input.kind === 'issue' || input.kind === 'collect') && !input.location) {
      throw badRequest('location_required', 'Say which ward or location the linen goes to or comes from');
    }
    if (input.kind === 'condemn' && !input.fromPool) throw badRequest('pool_required', 'Say whether condemned linen comes from clean or soiled stock');
    return this.db.tx(async (tx) => {
      const [item] = await tx.select().from(opsLinenItems).where(eq(opsLinenItems.id, input.itemId));
      if (!item) throw notFound('Linen item');
      if (!item.isActive) throw conflict('item_inactive', `${item.name} is inactive`);
      // Serialise movements of one item in one facility so two clerks cannot overdraw a pool.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ops.linen:${facilityId}:${item.id}`}))`);
      const source: Pool | null = input.kind === 'stock_in' ? null : input.kind === 'condemn' ? (input.fromPool === 'clean' ? 'clean' : 'soiled') : SOURCE[input.kind];
      if (source) {
        const b = (await this.balances(tx, and(eq(opsLinenTxns.facilityId, facilityId), eq(opsLinenTxns.itemId, item.id)))).get(item.id) ?? empty();
        if (b[source] < input.qty) {
          throw conflict('insufficient_linen', `Only ${b[source]} ${item.name} in ${POOL_LABEL[source]}; cannot move ${input.qty}`);
        }
      }
      const [row] = await tx
        .insert(opsLinenTxns)
        .values({
          tenantId: item.tenantId,
          facilityId,
          itemId: item.id,
          kind: input.kind,
          qty: input.qty,
          location: input.location || null,
          fromPool: input.kind === 'condemn' ? input.fromPool! : null,
          reference: input.reference || null,
          notes: input.notes || null,
          createdBy: actorId(),
        })
        .returning();
      return txnDto(row!, item.name);
    });
  }

  /** Pool balances per item. */
  async balances(tx: Tx, where: SQL | undefined): Promise<Map<string, Balances>> {
    const t = opsLinenTxns;
    const sum = (cond: SQL) => sql<number>`coalesce(sum(${t.qty}) filter (where ${cond}), 0)::int`;
    const rows = await tx
      .select({
        itemId: t.itemId,
        stockIn: sum(sql`${t.kind} = 'stock_in'`),
        issue: sum(sql`${t.kind} = 'issue'`),
        collect: sum(sql`${t.kind} = 'collect'`),
        laundryOut: sum(sql`${t.kind} = 'laundry_out'`),
        laundryIn: sum(sql`${t.kind} = 'laundry_in'`),
        condemnClean: sum(sql`${t.kind} = 'condemn' and ${t.fromPool} = 'clean'`),
        condemnSoiled: sum(sql`${t.kind} = 'condemn' and ${t.fromPool} = 'soiled'`),
      })
      .from(t)
      .where(where)
      .groupBy(t.itemId);
    return new Map(
      rows.map((r) => [
        r.itemId,
        {
          clean: r.stockIn + r.laundryIn - r.issue - r.condemnClean,
          inUse: r.issue - r.collect,
          soiled: r.collect - r.laundryOut - r.condemnSoiled,
          atLaundry: r.laundryOut - r.laundryIn,
          condemned: r.condemnClean + r.condemnSoiled,
        },
      ]),
    );
  }
}

const empty = (): Balances => ({ clean: 0, inUse: 0, soiled: 0, atLaundry: 0, condemned: 0 });

function itemDto(r: ItemRow): O.LinenItem {
  return { id: r.id, name: r.name, parLevel: r.parLevel, isActive: r.isActive };
}

function txnDto(r: typeof opsLinenTxns.$inferSelect, itemName: string): O.LinenTxn {
  return {
    id: r.id,
    itemId: r.itemId,
    itemName,
    kind: r.kind as O.LinenTxnKind,
    qty: r.qty,
    location: r.location,
    fromPool: r.fromPool as O.LinenTxn['fromPool'],
    reference: r.reference,
    notes: r.notes,
    createdAt: iso(r.createdAt),
  };
}
