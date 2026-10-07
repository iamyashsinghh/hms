import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, formatSeries, ilike, iso, nextCounter, opsAssets, opsWorkOrders, or, sql, type Tx } from '@hms/db';
import type { Paginated, ops as O } from '@hms/shared';
import type { z } from 'zod';
import { DbService } from '../../common/db/db.service';
import { OutboxService } from '../../common/events/outbox.service';
import { currentContext } from '../../common/context/request-context';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors/errors';
import { actorId, addDays, dec, defined, facilityCond, num, requireFacility, today } from './ops.common';

type AssetRow = typeof opsAssets.$inferSelect;
type WorkOrderRow = typeof opsWorkOrders.$inferSelect;
type SQL = ReturnType<typeof sql>;
type AssetIn = z.output<typeof O.assetInputSchema>;
type AssetPatch = z.output<typeof O.updateAssetSchema>;
type WorkOrderPatch = z.output<typeof O.updateWorkOrderSchema>;

const OPEN = ['open', 'in_progress'];

/** Biomedical equipment register, PM/calibration schedule and maintenance work orders. */
@Injectable()
export class AssetsService {
  constructor(
    private readonly db: DbService,
    private readonly outbox: OutboxService,
  ) {}

  list(q: { q?: string; status?: O.AssetStatus; category?: O.AssetCategory; dueWithinDays?: number; page: number; pageSize: number }): Promise<Paginated<O.Asset>> {
    return this.db.tx(async (tx) => {
      const conds: (SQL | undefined)[] = [facilityCond(opsAssets.facilityId)];
      if (q.status) conds.push(eq(opsAssets.status, q.status));
      if (q.category) conds.push(eq(opsAssets.category, q.category));
      if (q.q) {
        const term = `%${q.q}%`;
        conds.push(or(ilike(opsAssets.name, term), ilike(opsAssets.code, term), ilike(opsAssets.serialNo, term), ilike(opsAssets.location, term)));
      }
      if (q.dueWithinDays !== undefined) {
        const until = addDays(today(), q.dueWithinDays);
        conds.push(sql`${opsAssets.status} <> 'condemned' and (${opsAssets.nextPmDue} <= ${until} or ${opsAssets.calibrationDue} <= ${until}
          or ${opsAssets.warrantyUntil} between ${today()} and ${until} or ${opsAssets.amcUntil} between ${today()} and ${until})`);
      }
      const where = and(...conds);
      const [rows, [{ total }]] = await Promise.all([
        tx
          .select({ a: opsAssets, open: openCount })
          .from(opsAssets)
          .where(where)
          .orderBy(opsAssets.name)
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        tx.select({ total: count() }).from(opsAssets).where(where),
      ]);
      return { items: rows.map((r) => assetDto(r.a, r.open)), page: q.page, pageSize: q.pageSize, total };
    });
  }

  get(id: string): Promise<O.Asset> {
    return this.db.tx(async (tx) => {
      const [r] = await tx.select({ a: opsAssets, open: openCount }).from(opsAssets).where(eq(opsAssets.id, id));
      if (!r) throw notFound('Equipment');
      return assetDto(r.a, r.open);
    });
  }

  create(input: AssetIn): Promise<O.Asset> {
    const facilityId = requireFacility();
    return this.db.tx(async (tx) => {
      const code = formatSeries('BME', await nextCounter(tx, 'ops.asset'), 5);
      const nextPmDue = input.nextPmDue ?? (input.pmIntervalDays ? addDays(today(), input.pmIntervalDays) : null);
      const [row] = await tx
        .insert(opsAssets)
        .values({
          tenantId: currentContext()!.tenantId!,
          facilityId,
          code,
          ...columns(input),
          name: input.name,
          nextPmDue,
          createdBy: actorId(),
          updatedBy: actorId(),
        })
        .returning();
      return assetDto(row!, 0);
    });
  }

  update(id: string, input: AssetPatch): Promise<O.Asset> {
    return this.db.tx(async (tx) => {
      const asset = await this.lockAsset(tx, id);
      if (asset.status === 'condemned') throw conflict('asset_condemned', 'Condemned equipment cannot be changed');
      let status: string | undefined;
      if (input.status && input.status !== asset.status) {
        if (asset.status === 'under_maintenance' && input.status === 'in_service') {
          throw conflict('open_breakdown', 'Close the open breakdown work order to put this equipment back in service');
        }
        status = input.status;
      }
      const [row] = await tx
        .update(opsAssets)
        .set({ ...columns(input), status, updatedBy: actorId() })
        .where(eq(opsAssets.id, id))
        .returning();
      if (status === 'condemned') {
        await tx
          .update(opsWorkOrders)
          .set({ status: 'cancelled', resolution: 'Equipment condemned', completedAt: sql`now()` })
          .where(and(eq(opsWorkOrders.assetId, id), sql`${opsWorkOrders.status} in ('open', 'in_progress')`));
      }
      const [{ open }] = await tx.select({ open: openCount }).from(opsAssets).where(eq(opsAssets.id, id));
      return assetDto(row!, open);
    });
  }

  // ---------- work orders ----------

  listWorkOrders(q: { assetId?: string; status?: O.WorkOrderStatus; type?: O.WorkOrderType; open?: 'true' | 'false'; page: number; pageSize: number }): Promise<Paginated<O.WorkOrder>> {
    return this.db.tx(async (tx) => {
      const conds: (SQL | undefined)[] = [facilityCond(opsWorkOrders.facilityId)];
      if (q.assetId) conds.push(eq(opsWorkOrders.assetId, q.assetId));
      if (q.status) conds.push(eq(opsWorkOrders.status, q.status));
      if (q.type) conds.push(eq(opsWorkOrders.type, q.type));
      if (q.open === 'true') conds.push(sql`${opsWorkOrders.status} in ('open', 'in_progress')`);
      if (q.open === 'false') conds.push(sql`${opsWorkOrders.status} in ('completed', 'cancelled')`);
      const where = and(...conds);
      const [rows, [{ total }]] = await Promise.all([
        tx
          .select({ w: opsWorkOrders, code: opsAssets.code, name: opsAssets.name })
          .from(opsWorkOrders)
          .innerJoin(opsAssets, and(eq(opsAssets.tenantId, opsWorkOrders.tenantId), eq(opsAssets.id, opsWorkOrders.assetId)))
          .where(where)
          .orderBy(desc(opsWorkOrders.reportedAt))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        tx.select({ total: count() }).from(opsWorkOrders).where(where),
      ]);
      return { items: rows.map((r) => woDto(r.w, r.code, r.name)), page: q.page, pageSize: q.pageSize, total };
    });
  }

  createWorkOrder(input: { assetId: string; type: O.WorkOrderType; problem: string; priority: 'low' | 'normal' | 'urgent' }): Promise<O.WorkOrder> {
    const ctx = currentContext()!;
    const needed = input.type === 'breakdown' ? 'ops.asset.report' : 'ops.asset.manage';
    if (!ctx.permissions.has(needed)) {
      throw forbidden(input.type === 'breakdown' ? 'You cannot report breakdowns' : 'Only equipment managers can schedule PM or calibration');
    }
    return this.db.tx(async (tx) => {
      const asset = await this.lockAsset(tx, input.assetId);
      if (asset.status === 'condemned') throw conflict('asset_condemned', 'This equipment has been condemned');
      const [dup] = await tx
        .select({ number: opsWorkOrders.number })
        .from(opsWorkOrders)
        .where(and(eq(opsWorkOrders.assetId, asset.id), eq(opsWorkOrders.type, input.type), sql`${opsWorkOrders.status} in ('open', 'in_progress')`));
      if (dup) throw conflict('work_order_open', `Work order ${dup.number} is already open for this equipment`);

      const number = formatSeries('WO', await nextCounter(tx, 'ops.work_order'));
      const [row] = await tx
        .insert(opsWorkOrders)
        .values({
          tenantId: ctx.tenantId!,
          number,
          assetId: asset.id,
          facilityId: asset.facilityId,
          type: input.type,
          priority: input.type === 'breakdown' && asset.criticality === 'high' ? 'urgent' : input.priority,
          problem: input.problem,
          reportedBy: actorId(),
        })
        .returning();
      if (input.type === 'breakdown') {
        await tx.update(opsAssets).set({ status: 'under_maintenance', updatedBy: actorId() }).where(eq(opsAssets.id, asset.id));
        const event: O.AssetBreakdownReportedEvent = {
          workOrderId: row!.id,
          assetId: asset.id,
          assetName: asset.name,
          facilityId: asset.facilityId,
          criticality: asset.criticality as O.AssetCriticality,
        };
        await this.outbox.publish(tx, 'ops.asset.breakdown_reported', event);
      }
      return woDto(row!, asset.code, asset.name);
    });
  }

  updateWorkOrder(id: string, input: WorkOrderPatch): Promise<O.WorkOrder> {
    return this.db.tx(async (tx) => {
      const [wo] = await tx.select().from(opsWorkOrders).where(eq(opsWorkOrders.id, id)).for('update');
      if (!wo) throw notFound('Work order');
      if (!OPEN.includes(wo.status)) throw conflict('work_order_closed', `Work order ${wo.number} is already ${wo.status}`);
      if (input.status === 'in_progress' && wo.status !== 'open') throw conflict('bad_transition', 'Work order is already in progress');
      const asset = await this.lockAsset(tx, wo.assetId);

      const closing = input.status === 'completed' || input.status === 'cancelled';
      if (input.status === 'completed' && !input.resolution?.trim()) throw badRequest('resolution_required', 'Write what was done before closing');
      const [row] = await tx
        .update(opsWorkOrders)
        .set(
          defined({
            status: input.status,
            assignedTo: input.assignedTo,
            resolution: input.resolution,
            cost: dec(input.cost),
            startedAt: input.status === 'in_progress' ? sql`now()` : undefined,
            completedAt: closing ? sql`now()` : undefined,
          }),
        )
        .where(eq(opsWorkOrders.id, id))
        .returning();

      if (input.status === 'completed' && wo.type === 'preventive' && asset.pmIntervalDays) {
        await tx.update(opsAssets).set({ nextPmDue: addDays(today(), asset.pmIntervalDays), updatedBy: actorId() }).where(eq(opsAssets.id, asset.id));
      }
      if (input.status === 'completed' && wo.type === 'calibration') {
        await tx
          .update(opsAssets)
          .set({ calibrationDue: input.nextCalibrationDue ?? addDays(today(), 365), updatedBy: actorId() })
          .where(eq(opsAssets.id, asset.id));
      }
      if (closing && wo.type === 'breakdown' && asset.status === 'under_maintenance') {
        await tx.update(opsAssets).set({ status: 'in_service', updatedBy: actorId() }).where(eq(opsAssets.id, asset.id));
      }
      return woDto(row!, asset.code, asset.name);
    });
  }

  private async lockAsset(tx: Tx, id: string): Promise<AssetRow> {
    const [a] = await tx.select().from(opsAssets).where(eq(opsAssets.id, id)).for('update');
    if (!a) throw notFound('Equipment');
    return a;
  }
}

const openCount = sql<number>`(select count(*)::int from ops.work_orders w
  where w.tenant_id = ops.assets.tenant_id and w.asset_id = ops.assets.id and w.status in ('open', 'in_progress'))`;

function columns(i: AssetPatch) {
  const nul = <T>(v: T | undefined) => (v === undefined ? undefined : v === '' ? null : v);
  return defined({
    name: i.name,
    category: i.category,
    criticality: i.criticality,
    make: nul(i.make),
    model: nul(i.model),
    serialNo: nul(i.serialNo),
    location: nul(i.location),
    departmentId: i.departmentId,
    purchaseDate: i.purchaseDate,
    purchaseCost: dec(i.purchaseCost),
    vendor: nul(i.vendor),
    warrantyUntil: i.warrantyUntil,
    amcVendor: nul(i.amcVendor),
    amcUntil: i.amcUntil,
    pmIntervalDays: i.pmIntervalDays === undefined ? undefined : i.pmIntervalDays || null,
    nextPmDue: i.nextPmDue,
    calibrationDue: i.calibrationDue,
    notes: nul(i.notes),
  });
}

function assetDto(r: AssetRow, open: number): O.Asset {
  return {
    id: r.id,
    code: r.code,
    facilityId: r.facilityId,
    name: r.name,
    category: r.category as O.AssetCategory,
    criticality: r.criticality as O.AssetCriticality,
    status: r.status as O.AssetStatus,
    make: r.make,
    model: r.model,
    serialNo: r.serialNo,
    location: r.location,
    departmentId: r.departmentId,
    purchaseDate: r.purchaseDate,
    purchaseCost: num(r.purchaseCost),
    vendor: r.vendor,
    warrantyUntil: r.warrantyUntil,
    amcVendor: r.amcVendor,
    amcUntil: r.amcUntil,
    pmIntervalDays: r.pmIntervalDays,
    nextPmDue: r.nextPmDue,
    calibrationDue: r.calibrationDue,
    notes: r.notes,
    openWorkOrders: Number(open),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function woDto(r: WorkOrderRow, assetCode: string, assetName: string): O.WorkOrder {
  const downtime =
    r.type === 'breakdown' && r.completedAt ? Math.round((new Date(r.completedAt).getTime() - new Date(r.reportedAt).getTime()) / 60000) : null;
  return {
    id: r.id,
    number: r.number,
    assetId: r.assetId,
    assetCode,
    assetName,
    facilityId: r.facilityId,
    type: r.type as O.WorkOrderType,
    priority: r.priority as O.WorkOrder['priority'],
    status: r.status as O.WorkOrderStatus,
    problem: r.problem,
    assignedTo: r.assignedTo,
    resolution: r.resolution,
    cost: num(r.cost),
    reportedBy: r.reportedBy,
    reportedAt: iso(r.reportedAt),
    startedAt: iso(r.startedAt),
    completedAt: iso(r.completedAt),
    downtimeMinutes: downtime,
  };
}
