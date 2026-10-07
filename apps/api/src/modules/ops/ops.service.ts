import { Injectable } from '@nestjs/common';
import { and, opsAssets, opsCssdCycles, opsCssdSets, opsDietOrders, opsHkTasks, opsTrips, opsVehicles, opsWorkOrders, sql } from '@hms/db';
import type { ops as O } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { LinenService } from './linen.service';
import { addDays, facilityCond, today } from './ops.common';

const n = (cond: ReturnType<typeof sql>) => sql<number>`(count(*) filter (where ${cond}))::int`;

/** Facility services overview: one number per area for the dashboard. */
@Injectable()
export class OpsService {
  constructor(
    private readonly db: DbService,
    private readonly linen: LinenService,
  ) {}

  async summary(): Promise<O.OpsSummary> {
    const d = today();
    const soon = addDays(d, 7);
    const isToday = (col: Parameters<typeof facilityCond>[0]) => sql`(${col} at time zone 'Asia/Kolkata')::date = ${d}::date`;
    const stock = await this.linen.stock();
    return this.db.tx(async (tx) => {
      const [assets] = await tx
        .select({
          total: n(sql`${opsAssets.status} <> 'condemned'`),
          underMaintenance: n(sql`${opsAssets.status} = 'under_maintenance'`),
          outOfService: n(sql`${opsAssets.status} = 'out_of_service'`),
          pmDue: n(sql`${opsAssets.status} <> 'condemned' and ${opsAssets.nextPmDue} <= ${soon}::date`),
          calibrationDue: n(sql`${opsAssets.status} <> 'condemned' and ${opsAssets.calibrationDue} <= ${soon}::date`),
        })
        .from(opsAssets)
        .where(facilityCond(opsAssets.facilityId));
      const [breakdowns] = await tx
        .select({ openBreakdowns: n(sql`${opsWorkOrders.type} = 'breakdown' and ${opsWorkOrders.status} in ('open', 'in_progress')`) })
        .from(opsWorkOrders)
        .where(facilityCond(opsWorkOrders.facilityId));
      const [cssd] = await tx
        .select({
          sterile: n(sql`${opsCssdSets.status} = 'sterile' and ${opsCssdSets.sterileUntil} >= now()`),
          expired: n(sql`${opsCssdSets.status} = 'sterile' and ${opsCssdSets.sterileUntil} < now()`),
          issued: n(sql`${opsCssdSets.status} = 'issued'`),
          dirty: n(sql`${opsCssdSets.status} = 'dirty'`),
        })
        .from(opsCssdSets)
        .where(and(facilityCond(opsCssdSets.facilityId), sql`${opsCssdSets.isActive}`));
      const [cycles] = await tx
        .select({ cyclesToday: n(sql`true`), failedToday: n(sql`${opsCssdCycles.status} = 'failed'`) })
        .from(opsCssdCycles)
        .where(and(facilityCond(opsCssdCycles.facilityId), isToday(opsCssdCycles.startedAt)));
      const [vehicles] = await tx
        .select({ available: n(sql`${opsVehicles.status} = 'available'`) })
        .from(opsVehicles)
        .where(facilityCond(opsVehicles.facilityId));
      const [trips] = await tx
        .select({
          activeTrips: n(sql`${opsTrips.status} in ('requested', 'dispatched', 'patient_onboard')`),
          tripsToday: n(isToday(opsTrips.requestedAt)),
        })
        .from(opsTrips)
        .where(facilityCond(opsTrips.facilityId));
      const [diet] = await tx
        .select({ activeOrders: n(sql`${opsDietOrders.status} = 'active'`) })
        .from(opsDietOrders)
        .where(facilityCond(opsDietOrders.facilityId));
      const [hk] = await tx
        .select({
          pending: n(sql`${opsHkTasks.status} = 'pending'`),
          inProgress: n(sql`${opsHkTasks.status} = 'in_progress'`),
          overdue: n(sql`${opsHkTasks.status} in ('pending', 'in_progress') and ${opsHkTasks.dueAt} < now()`),
          awaitingVerification: n(sql`${opsHkTasks.status} = 'done'`),
        })
        .from(opsHkTasks)
        .where(facilityCond(opsHkTasks.facilityId));
      return {
        assets: { ...assets!, ...breakdowns! },
        cssd: { ...cssd!, ...cycles! },
        linen: { belowPar: stock.filter((s) => s.belowPar).length, atLaundry: stock.reduce((a, s) => a + s.atLaundry, 0) },
        ambulance: { ...vehicles!, ...trips! },
        diet: diet!,
        housekeeping: hk!,
      };
    });
  }
}
