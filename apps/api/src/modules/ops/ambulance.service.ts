import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, iso, formatSeries, nextCounter, opsTrips, opsVehicles, sql, type Tx } from '@hms/db';
import type { Paginated, ops as O } from '@hms/shared';
import type { z } from 'zod';
import { DbService } from '../../common/db/db.service';
import { OutboxService } from '../../common/events/outbox.service';
import { currentContext } from '../../common/context/request-context';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { BillingService } from '../billing/billing.service';
import { PatientsService } from '../patients/patients.service';
import { actorId, dec, defined, facilityCond, num, requireFacility } from './ops.common';

type VehicleRow = typeof opsVehicles.$inferSelect;
type TripRow = typeof opsTrips.$inferSelect;
type SQL = ReturnType<typeof sql>;
type VehicleIn = z.output<typeof O.vehicleInputSchema>;
type TripActionIn = z.output<typeof O.tripActionSchema>;

const KIND_LABEL: Record<O.TripKind, string> = {
  emergency_pickup: 'emergency pickup',
  inter_hospital_transfer: 'inter-hospital transfer',
  drop_home: 'drop home',
  other: 'trip',
};

/** Ambulance fleet and trips: request -> dispatch -> patient on board -> complete (optionally billed). */
@Injectable()
export class AmbulanceService {
  constructor(
    private readonly db: DbService,
    private readonly outbox: OutboxService,
    private readonly billing: BillingService,
    private readonly patients: PatientsService,
  ) {}

  listVehicles(): Promise<O.Vehicle[]> {
    return this.db.tx(async (tx) =>
      (await tx.select().from(opsVehicles).where(facilityCond(opsVehicles.facilityId)).orderBy(opsVehicles.registrationNo)).map(vehicleDto),
    );
  }

  createVehicle(input: VehicleIn): Promise<O.Vehicle> {
    const facilityId = requireFacility();
    return this.db.tx(async (tx) => {
      const [dup] = await tx.select({ id: opsVehicles.id }).from(opsVehicles).where(eq(opsVehicles.registrationNo, input.registrationNo));
      if (dup) throw conflict('duplicate_vehicle', `${input.registrationNo} is already registered`);
      const [row] = await tx
        .insert(opsVehicles)
        .values({
          tenantId: currentContext()!.tenantId!,
          facilityId,
          registrationNo: input.registrationNo,
          type: input.type,
          status: input.status ?? 'available',
          driverName: input.driverName || null,
          driverMobile: input.driverMobile || null,
          ratePerKm: dec(input.ratePerKm) ?? '0',
          baseCharge: dec(input.baseCharge) ?? '0',
        })
        .returning();
      return vehicleDto(row!);
    });
  }

  updateVehicle(id: string, input: Partial<VehicleIn>): Promise<O.Vehicle> {
    return this.db.tx(async (tx) => {
      const [v] = await tx.select().from(opsVehicles).where(eq(opsVehicles.id, id)).for('update');
      if (!v) throw notFound('Ambulance');
      if (input.status && v.status === 'on_trip') throw conflict('vehicle_on_trip', `${v.registrationNo} is on a trip; complete or cancel it first`);
      const [row] = await tx
        .update(opsVehicles)
        .set(
          defined({
            registrationNo: input.registrationNo,
            type: input.type,
            status: input.status,
            driverName: input.driverName,
            driverMobile: input.driverMobile,
            ratePerKm: dec(input.ratePerKm),
            baseCharge: dec(input.baseCharge),
          }),
        )
        .where(eq(opsVehicles.id, id))
        .returning();
      return vehicleDto(row!);
    });
  }

  listTrips(q: { status?: O.TripStatus; active?: 'true' | 'false'; date?: string; page: number; pageSize: number }): Promise<Paginated<O.Trip>> {
    return this.db.tx(async (tx) => {
      const conds: (SQL | undefined)[] = [facilityCond(opsTrips.facilityId)];
      if (q.status) conds.push(eq(opsTrips.status, q.status));
      if (q.active === 'true') conds.push(sql`${opsTrips.status} in ('requested', 'dispatched', 'patient_onboard')`);
      if (q.active === 'false') conds.push(sql`${opsTrips.status} in ('completed', 'cancelled')`);
      if (q.date) conds.push(sql`(${opsTrips.requestedAt} at time zone 'Asia/Kolkata')::date = ${q.date}::date`);
      const where = and(...conds);
      const [rows, [{ total }]] = await Promise.all([
        this.tripQuery(tx).where(where).orderBy(desc(opsTrips.requestedAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ total: count() }).from(opsTrips).where(where),
      ]);
      return { items: rows.map((r) => tripDto(r.t, r.reg)), page: q.page, pageSize: q.pageSize, total };
    });
  }

  getTrip(id: string): Promise<O.Trip> {
    return this.db.tx(async (tx) => this.loadTrip(tx, id));
  }

  async createTrip(input: z.output<typeof O.createTripSchema>): Promise<O.Trip> {
    const facilityId = requireFacility();
    if (input.patientId) await this.patients.get(input.patientId);
    return this.db.tx(async (tx) => {
      const number = formatSeries('AMB', await nextCounter(tx, 'ops.trip'));
      const [row] = await tx
        .insert(opsTrips)
        .values({
          tenantId: currentContext()!.tenantId!,
          number,
          facilityId,
          kind: input.kind,
          patientId: input.patientId ?? null,
          contactName: input.contactName,
          contactMobile: input.contactMobile,
          pickupAddress: input.pickupAddress,
          dropAddress: input.dropAddress || null,
          notes: input.notes || null,
          requestedBy: actorId(),
        })
        .returning();
      if (input.vehicleId) await this.dispatch(tx, row!, input.vehicleId);
      return this.loadTrip(tx, row!.id);
    });
  }

  act(id: string, input: TripActionIn): Promise<O.Trip> {
    return this.db.tx(async (tx) => {
      const [trip] = await tx.select().from(opsTrips).where(eq(opsTrips.id, id)).for('update');
      if (!trip) throw notFound('Trip');
      if (trip.status === 'completed' || trip.status === 'cancelled') throw conflict('trip_closed', `Trip ${trip.number} is already ${trip.status}`);

      switch (input.action) {
        case 'dispatch':
          if (trip.status !== 'requested') throw conflict('bad_transition', 'An ambulance is already dispatched for this trip');
          await this.dispatch(tx, trip, input.vehicleId, input.odometerStart);
          break;
        case 'onboard':
          if (trip.status !== 'dispatched') throw conflict('bad_transition', 'Dispatch an ambulance first');
          await tx.update(opsTrips).set({ status: 'patient_onboard', onboardAt: sql`now()` }).where(eq(opsTrips.id, id));
          break;
        case 'complete':
          if (trip.status === 'requested') throw conflict('bad_transition', 'Dispatch an ambulance before completing the trip');
          await this.complete(tx, trip, input);
          break;
        case 'cancel':
          await tx.update(opsTrips).set({ status: 'cancelled', cancelReason: input.reason, completedAt: sql`now()` }).where(eq(opsTrips.id, id));
          if (trip.vehicleId) await this.release(tx, trip.vehicleId);
          break;
      }
      return this.loadTrip(tx, id);
    });
  }

  private async dispatch(tx: Tx, trip: TripRow, vehicleId: string, odometerStart?: number) {
    const [v] = await tx.select().from(opsVehicles).where(eq(opsVehicles.id, vehicleId)).for('update');
    if (!v) throw notFound('Ambulance');
    if (v.facilityId !== trip.facilityId) throw badRequest('wrong_facility', `${v.registrationNo} belongs to another facility`);
    if (v.status !== 'available') throw conflict('vehicle_unavailable', `${v.registrationNo} is ${v.status.replace('_', ' ')}`);
    await tx.update(opsVehicles).set({ status: 'on_trip' }).where(eq(opsVehicles.id, v.id));
    await tx
      .update(opsTrips)
      .set({ status: 'dispatched', vehicleId: v.id, odometerStart: odometerStart ?? null, dispatchedAt: sql`now()` })
      .where(eq(opsTrips.id, trip.id));
  }

  private async complete(tx: Tx, trip: TripRow, input: Extract<TripActionIn, { action: 'complete' }>) {
    const [v] = await tx.select().from(opsVehicles).where(eq(opsVehicles.id, trip.vehicleId!));
    if (input.odometerEnd !== undefined && trip.odometerStart !== null && input.odometerEnd < trip.odometerStart) {
      throw badRequest('bad_odometer', `End reading must be at least the start reading (${trip.odometerStart})`);
    }
    const distance =
      input.odometerEnd !== undefined && trip.odometerStart !== null ? input.odometerEnd - trip.odometerStart : (input.distanceKm ?? null);
    const computed = Number(v!.baseCharge) + Number(v!.ratePerKm) * (distance ?? 0);
    const charge = Math.round((input.charge ?? computed) * 100) / 100;

    let invoiceId: string | null = null;
    if (input.bill) {
      if (!trip.patientId) throw badRequest('patient_required', 'Link a registered patient to bill this trip');
      if (charge <= 0) throw badRequest('no_charge', 'Set a charge for this trip (or a base charge / rate per km on the ambulance)');
      const km = distance !== null ? ` (${distance} km)` : '';
      const inv = await this.billing.createInvoice(tx, {
        patientId: trip.patientId,
        facilityId: trip.facilityId,
        source: { module: 'ops', refId: trip.id },
        lines: [{ description: `Ambulance ${KIND_LABEL[trip.kind as O.TripKind]} ${v!.registrationNo}${km}`, qty: 1, unitPrice: charge, taxRate: 0 }],
        notes: `Trip ${trip.number}`,
      });
      invoiceId = inv.invoiceId;
    }
    await tx
      .update(opsTrips)
      .set({
        status: 'completed',
        odometerEnd: input.odometerEnd ?? null,
        distanceKm: distance === null ? null : distance.toFixed(1),
        charge: charge.toFixed(2),
        invoiceId,
        completedAt: sql`now()`,
      })
      .where(eq(opsTrips.id, trip.id));
    await this.release(tx, trip.vehicleId!);
    const event: O.TripCompletedEvent = { tripId: trip.id, patientId: trip.patientId, facilityId: trip.facilityId, invoiceId, distanceKm: distance };
    await this.outbox.publish(tx, 'ops.trip.completed', event);
  }

  private async release(tx: Tx, vehicleId: string) {
    await tx.update(opsVehicles).set({ status: 'available' }).where(and(eq(opsVehicles.id, vehicleId), eq(opsVehicles.status, 'on_trip')));
  }

  private tripQuery(tx: Tx) {
    return tx
      .select({ t: opsTrips, reg: opsVehicles.registrationNo })
      .from(opsTrips)
      .leftJoin(opsVehicles, and(eq(opsVehicles.tenantId, opsTrips.tenantId), eq(opsVehicles.id, opsTrips.vehicleId)))
      .$dynamic();
  }

  private async loadTrip(tx: Tx, id: string): Promise<O.Trip> {
    const [r] = await this.tripQuery(tx).where(eq(opsTrips.id, id));
    if (!r) throw notFound('Trip');
    return tripDto(r.t, r.reg);
  }
}

function vehicleDto(r: VehicleRow): O.Vehicle {
  return {
    id: r.id,
    facilityId: r.facilityId,
    registrationNo: r.registrationNo,
    type: r.type as O.VehicleType,
    status: r.status as O.VehicleStatus,
    driverName: r.driverName,
    driverMobile: r.driverMobile,
    ratePerKm: Number(r.ratePerKm),
    baseCharge: Number(r.baseCharge),
  };
}

function tripDto(r: TripRow, reg: string | null): O.Trip {
  return {
    id: r.id,
    number: r.number,
    facilityId: r.facilityId,
    kind: r.kind as O.TripKind,
    status: r.status as O.TripStatus,
    patientId: r.patientId,
    contactName: r.contactName,
    contactMobile: r.contactMobile,
    pickupAddress: r.pickupAddress,
    dropAddress: r.dropAddress,
    notes: r.notes,
    vehicleId: r.vehicleId,
    vehicleRegistrationNo: reg,
    odometerStart: r.odometerStart,
    odometerEnd: r.odometerEnd,
    distanceKm: num(r.distanceKm),
    charge: num(r.charge),
    invoiceId: r.invoiceId,
    cancelReason: r.cancelReason,
    requestedAt: iso(r.requestedAt),
    dispatchedAt: iso(r.dispatchedAt),
    onboardAt: iso(r.onboardAt),
    completedAt: iso(r.completedAt),
  };
}
