import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, iso, pharmacyItems, pharmacyStores, sql, type Tx } from '@hms/db';
import type { pharmacy } from '@hms/shared';
import type { z } from 'zod';
import { DbService } from '../../common/db/db.service';
import { currentContext } from '../../common/context/request-context';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { num } from './money';

type ItemRow = typeof pharmacyItems.$inferSelect;
type StoreRow = typeof pharmacyStores.$inferSelect;

/** Item (drug) master and stores. */
@Injectable()
export class PharmacyCatalogService {
  constructor(private readonly db: DbService) {}

  searchItems(q: z.output<typeof pharmacy.itemSearchQuerySchema>): Promise<{ items: pharmacy.Item[]; page: number; pageSize: number; total: number }> {
    return this.db.tx(async (tx) => {
      const term = q.q?.toLowerCase();
      const filter = and(
        q.includeInactive ? undefined : eq(pharmacyItems.isActive, true),
        term
          ? sql`(upper(${pharmacyItems.code}) = upper(${term})
                or lower(${pharmacyItems.name}) like ${'%' + term + '%'}
                or lower(coalesce(${pharmacyItems.genericName}, '')) like ${'%' + term + '%'}
                or lower(${pharmacyItems.name}) % ${term})`
          : undefined,
      );
      const [rows, [{ total }]] = await Promise.all([
        tx
          .select()
          .from(pharmacyItems)
          .where(filter)
          .orderBy(term ? sql`upper(${pharmacyItems.code}) = upper(${term}) desc, similarity(lower(${pharmacyItems.name}), ${term}) desc` : asc(pharmacyItems.name), asc(pharmacyItems.name))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        tx.select({ total: count() }).from(pharmacyItems).where(filter),
      ]);
      return { items: rows.map(itemDto), page: q.page, pageSize: q.pageSize, total };
    });
  }

  getItem(id: string): Promise<pharmacy.Item> {
    return this.db.tx(async (tx) => itemDto(await this.itemRow(tx, id)));
  }

  async itemRow(tx: Tx, id: string): Promise<ItemRow> {
    const [row] = await tx.select().from(pharmacyItems).where(eq(pharmacyItems.id, id)).limit(1);
    if (!row) throw notFound('Item');
    return row;
  }

  createItem(input: z.output<typeof pharmacy.createItemSchema>): Promise<pharmacy.Item> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const [dup] = await tx.select({ id: pharmacyItems.id }).from(pharmacyItems).where(sql`upper(${pharmacyItems.code}) = upper(${input.code})`).limit(1);
      if (dup) throw conflict('item_code_taken', `Item code ${input.code.toUpperCase()} already exists`);
      const [row] = await tx
        .insert(pharmacyItems)
        .values({
          ...itemColumns(input),
          tenantId: ctx.tenantId!,
          code: input.code.toUpperCase(),
          name: input.name,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning();
      return itemDto(row!);
    });
  }

  updateItem(id: string, input: z.output<typeof pharmacy.updateItemSchema>): Promise<pharmacy.Item> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const [row] = await tx
        .update(pharmacyItems)
        .set({ ...itemColumns(input), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}), updatedBy: ctx.userId })
        .where(eq(pharmacyItems.id, id))
        .returning();
      if (!row) throw notFound('Item');
      return itemDto(row);
    });
  }

  listStores(includeInactive = false): Promise<pharmacy.Store[]> {
    return this.db.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(pharmacyStores)
        .where(includeInactive ? undefined : eq(pharmacyStores.isActive, true))
        .orderBy(asc(pharmacyStores.name));
      const ctx = currentContext();
      const mine = ctx && ctx.facilityIds !== 'all' ? rows.filter((s) => (ctx.facilityIds as string[]).includes(s.facilityId)) : rows;
      return mine.map(storeDto);
    });
  }

  createStore(input: z.output<typeof pharmacy.createStoreSchema>): Promise<pharmacy.Store> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      if (ctx.facilityIds !== 'all' && !ctx.facilityIds.includes(input.facilityId)) {
        throw badRequest('unknown_facility', 'You do not work in this facility');
      }
      const [dup] = await tx.select({ id: pharmacyStores.id }).from(pharmacyStores).where(sql`upper(${pharmacyStores.code}) = upper(${input.code})`).limit(1);
      if (dup) throw conflict('store_code_taken', `Store code ${input.code.toUpperCase()} already exists`);
      const [row] = await tx
        .insert(pharmacyStores)
        .values({
          tenantId: ctx.tenantId!,
          facilityId: input.facilityId,
          code: input.code.toUpperCase(),
          name: input.name,
          type: input.type,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning()
        .catch((e: unknown) => {
          if (pgCode(e) === '23503') throw badRequest('unknown_facility', 'Facility not found');
          throw e;
        });
      return storeDto(row!);
    });
  }

  updateStore(id: string, input: z.output<typeof pharmacy.updateStoreSchema>): Promise<pharmacy.Store> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const [row] = await tx
        .update(pharmacyStores)
        .set({ ...input, updatedBy: ctx.userId })
        .where(eq(pharmacyStores.id, id))
        .returning();
      if (!row) throw notFound('Store');
      return storeDto(row);
    });
  }
}

function itemColumns(input: z.output<typeof pharmacy.updateItemSchema>): Partial<typeof pharmacyItems.$inferInsert> {
  const out: Partial<typeof pharmacyItems.$inferInsert> = {};
  if (input.name !== undefined) out.name = input.name;
  if (input.genericName !== undefined) out.genericName = input.genericName || null;
  if (input.form !== undefined) out.form = input.form;
  if (input.strength !== undefined) out.strength = input.strength || null;
  if (input.manufacturer !== undefined) out.manufacturer = input.manufacturer || null;
  if (input.hsnCode !== undefined) out.hsnCode = input.hsnCode || null;
  if (input.gstRate !== undefined) out.gstRate = String(input.gstRate);
  if (input.unit !== undefined) out.unit = input.unit;
  if (input.packSize !== undefined) out.packSize = input.packSize;
  if (input.schedule !== undefined) out.schedule = input.schedule;
  if (input.reorderLevel !== undefined) out.reorderLevel = input.reorderLevel;
  return out;
}

export function itemDto(r: ItemRow): pharmacy.Item {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    genericName: r.genericName,
    form: r.form as pharmacy.Item['form'],
    strength: r.strength,
    manufacturer: r.manufacturer,
    hsnCode: r.hsnCode,
    gstRate: num(r.gstRate),
    unit: r.unit,
    packSize: r.packSize,
    schedule: r.schedule as pharmacy.Item['schedule'],
    reorderLevel: r.reorderLevel,
    isActive: r.isActive,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export function storeDto(r: StoreRow): pharmacy.Store {
  return { id: r.id, facilityId: r.facilityId, code: r.code, name: r.name, type: r.type as pharmacy.Store['type'], isActive: r.isActive };
}

/** Postgres error code from a driver error (Drizzle wraps it in `cause`). */
export function pgCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code ?? err?.cause?.code;
}
