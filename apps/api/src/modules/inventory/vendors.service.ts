import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, iso, inventoryVendors, sql, type Tx } from '@hms/db';
import type { inventory, Paginated } from '@hms/shared';
import type { z } from 'zod';
import { DbService } from '../../common/db/db.service';
import { currentContext } from '../../common/context/request-context';
import { conflict, notFound } from '../../common/errors/errors';

type VendorRow = typeof inventoryVendors.$inferSelect;

@Injectable()
export class InventoryVendorsService {
  constructor(private readonly db: DbService) {}

  list(q: z.output<typeof inventory.vendorQuerySchema>): Promise<Paginated<inventory.Vendor>> {
    return this.db.tx(async (tx) => {
      const term = q.q?.toLowerCase();
      const where = and(
        q.includeInactive ? undefined : eq(inventoryVendors.isActive, true),
        term
          ? sql`(lower(${inventoryVendors.name}) like ${'%' + term + '%'} or upper(${inventoryVendors.code}) = upper(${term}) or ${inventoryVendors.gstin} = upper(${term}))`
          : undefined,
      );
      const [rows, [{ total }]] = await Promise.all([
        tx.select().from(inventoryVendors).where(where).orderBy(asc(inventoryVendors.name)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ total: count() }).from(inventoryVendors).where(where),
      ]);
      return { items: rows.map(vendorDto), page: q.page, pageSize: q.pageSize, total };
    });
  }

  get(id: string): Promise<inventory.Vendor> {
    return this.db.tx(async (tx) => vendorDto(await this.row(tx, id)));
  }

  create(input: z.output<typeof inventory.createVendorSchema>): Promise<inventory.Vendor> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const [dup] = await tx.select({ id: inventoryVendors.id }).from(inventoryVendors).where(sql`upper(${inventoryVendors.code}) = upper(${input.code})`).limit(1);
      if (dup) throw conflict('vendor_code_taken', `Vendor code ${input.code.toUpperCase()} already exists`);
      const [row] = await tx
        .insert(inventoryVendors)
        .values({ ...columns(input), tenantId: ctx.tenantId!, code: input.code.toUpperCase(), name: input.name, createdBy: ctx.userId, updatedBy: ctx.userId })
        .returning();
      return vendorDto(row!);
    });
  }

  update(id: string, input: z.output<typeof inventory.updateVendorSchema>): Promise<inventory.Vendor> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const [row] = await tx
        .update(inventoryVendors)
        .set({ ...columns(input), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}), updatedBy: ctx.userId })
        .where(eq(inventoryVendors.id, id))
        .returning();
      if (!row) throw notFound('Vendor');
      return vendorDto(row);
    });
  }

  async row(tx: Tx, id: string): Promise<VendorRow> {
    const [row] = await tx.select().from(inventoryVendors).where(eq(inventoryVendors.id, id)).limit(1);
    if (!row) throw notFound('Vendor');
    return row;
  }
}

function columns(input: z.output<typeof inventory.updateVendorSchema>): Partial<typeof inventoryVendors.$inferInsert> {
  const out: Partial<typeof inventoryVendors.$inferInsert> = {};
  if (input.name !== undefined) out.name = input.name;
  if (input.contactPerson !== undefined) out.contactPerson = input.contactPerson || null;
  if (input.phone !== undefined) out.phone = input.phone || null;
  if (input.email !== undefined) out.email = input.email || null;
  if (input.gstin !== undefined) out.gstin = input.gstin || null;
  if (input.pan !== undefined) out.pan = input.pan || null;
  if (input.address !== undefined) out.address = input.address || null;
  if (input.paymentTermsDays !== undefined) out.paymentTermsDays = input.paymentTermsDays;
  if (input.notes !== undefined) out.notes = input.notes || null;
  return out;
}

export function vendorDto(r: VendorRow): inventory.Vendor {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    contactPerson: r.contactPerson,
    phone: r.phone,
    email: r.email,
    gstin: r.gstin,
    pan: r.pan,
    address: r.address,
    paymentTermsDays: r.paymentTermsDays,
    notes: r.notes,
    isActive: r.isActive,
    createdAt: iso(r.createdAt),
  };
}
