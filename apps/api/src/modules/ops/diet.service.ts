import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, iso, opsDietMeals, opsDietOrders, sql } from '@hms/db';
import type { Paginated, ops as O } from '@hms/shared';
import type { z } from 'zod';
import { DbService } from '../../common/db/db.service';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { PatientsService } from '../patients/patients.service';
import { actorId, facilityCond, requireFacility, today } from './ops.common';
import { currentContext } from '../../common/context/request-context';

type OrderRow = typeof opsDietOrders.$inferSelect;
type SQL = ReturnType<typeof sql>;

/** Diet kitchen: one active diet order per patient, kitchen sheet per meal, meal delivery log. */
@Injectable()
export class DietService {
  constructor(
    private readonly db: DbService,
    private readonly patients: PatientsService,
  ) {}

  list(q: { status?: 'active' | 'stopped'; patientId?: string; page: number; pageSize: number }): Promise<Paginated<O.DietOrder>> {
    return this.db.tx(async (tx) => {
      const conds: (SQL | undefined)[] = [facilityCond(opsDietOrders.facilityId)];
      if (q.status) conds.push(eq(opsDietOrders.status, q.status));
      if (q.patientId) conds.push(eq(opsDietOrders.patientId, q.patientId));
      const where = and(...conds);
      const [rows, [{ total }]] = await Promise.all([
        tx
          .select()
          .from(opsDietOrders)
          .where(where)
          .orderBy(opsDietOrders.location, desc(opsDietOrders.createdAt))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        tx.select({ total: count() }).from(opsDietOrders).where(where),
      ]);
      return { items: rows.map(orderDto), page: q.page, pageSize: q.pageSize, total };
    });
  }

  /** Orders a diet; an existing active diet for the patient is stopped (the new order replaces it). */
  async order(input: z.output<typeof O.dietOrderInputSchema>): Promise<O.DietOrder> {
    const facilityId = requireFacility();
    const patient = await this.patients.get(input.patientId);
    const startDate = input.startDate ?? today();
    if (input.endDate && input.endDate < startDate) throw badRequest('bad_dates', 'End date is before the start date');
    return this.db.tx(async (tx) => {
      await tx
        .update(opsDietOrders)
        .set({ status: 'stopped', stoppedAt: sql`now()`, stoppedBy: actorId() })
        .where(and(eq(opsDietOrders.patientId, patient.id), eq(opsDietOrders.status, 'active')));
      const [row] = await tx
        .insert(opsDietOrders)
        .values({
          tenantId: currentContext()!.tenantId!,
          facilityId,
          patientId: patient.id,
          patientName: [patient.firstName, patient.lastName].filter(Boolean).join(' '),
          patientUhid: patient.uhid,
          allergies: patient.allergies ?? [],
          location: input.location,
          dietType: input.dietType,
          vegetarian: input.vegetarian,
          instructions: input.instructions || null,
          startDate,
          endDate: input.endDate ?? null,
          orderedBy: actorId(),
        })
        .returning();
      return orderDto(row!);
    });
  }

  stop(id: string): Promise<O.DietOrder> {
    return this.db.tx(async (tx) => {
      const [row] = await tx
        .update(opsDietOrders)
        .set({ status: 'stopped', stoppedAt: sql`now()`, stoppedBy: actorId() })
        .where(and(eq(opsDietOrders.id, id), eq(opsDietOrders.status, 'active')))
        .returning();
      if (!row) {
        const [exists] = await tx.select({ id: opsDietOrders.id }).from(opsDietOrders).where(eq(opsDietOrders.id, id));
        if (!exists) throw notFound('Diet order');
        throw conflict('already_stopped', 'This diet order is already stopped');
      }
      return orderDto(row);
    });
  }

  kitchenSheet(q: { date?: string; meal: O.Meal }): Promise<O.KitchenSheet> {
    const date = q.date ?? today();
    return this.db.tx(async (tx) => {
      const rows = await tx
        .select({ o: opsDietOrders, mealStatus: opsDietMeals.status })
        .from(opsDietOrders)
        .leftJoin(
          opsDietMeals,
          and(
            eq(opsDietMeals.tenantId, opsDietOrders.tenantId),
            eq(opsDietMeals.orderId, opsDietOrders.id),
            eq(opsDietMeals.mealDate, date),
            eq(opsDietMeals.meal, q.meal),
          ),
        )
        .where(
          and(
            facilityCond(opsDietOrders.facilityId),
            eq(opsDietOrders.status, 'active'),
            sql`${opsDietOrders.startDate} <= ${date}::date`,
            sql`(${opsDietOrders.endDate} is null or ${opsDietOrders.endDate} >= ${date}::date)`,
          ),
        )
        .orderBy(opsDietOrders.location);
      const counts = new Map<O.DietType, { vegetarian: number; nonVegetarian: number }>();
      for (const { o } of rows) {
        if (o.dietType === 'npo') continue;
        const c = counts.get(o.dietType as O.DietType) ?? { vegetarian: 0, nonVegetarian: 0 };
        if (o.vegetarian) c.vegetarian++;
        else c.nonVegetarian++;
        counts.set(o.dietType as O.DietType, c);
      }
      return {
        date,
        meal: q.meal,
        counts: [...counts].map(([dietType, c]) => ({ dietType, ...c })),
        rows: rows.map(({ o, mealStatus }) => ({
          id: o.id,
          patientName: o.patientName,
          patientUhid: o.patientUhid,
          location: o.location,
          dietType: o.dietType as O.DietType,
          vegetarian: o.vegetarian,
          instructions: o.instructions,
          allergies: o.allergies,
          mealStatus: (mealStatus as O.MealStatus | null) ?? null,
        })),
      };
    });
  }

  markMeal(input: z.output<typeof O.markMealSchema>): Promise<{ ok: true }> {
    const date = input.date ?? today();
    return this.db.tx(async (tx) => {
      const [o] = await tx.select().from(opsDietOrders).where(eq(opsDietOrders.id, input.orderId));
      if (!o) throw notFound('Diet order');
      if (o.status !== 'active') throw conflict('order_stopped', 'This diet order has been stopped');
      if (o.dietType === 'npo' && (input.status === 'prepared' || input.status === 'delivered')) {
        throw conflict('patient_npo', `${o.patientName} is nil by mouth (NPO); do not serve a meal`);
      }
      await tx
        .insert(opsDietMeals)
        .values({ tenantId: o.tenantId, orderId: o.id, mealDate: date, meal: input.meal, status: input.status, notes: input.notes || null, updatedBy: actorId() })
        .onConflictDoUpdate({
          target: [opsDietMeals.tenantId, opsDietMeals.orderId, opsDietMeals.mealDate, opsDietMeals.meal],
          set: { status: input.status, notes: input.notes || null, updatedBy: actorId() },
        });
      return { ok: true as const };
    });
  }
}

function orderDto(r: OrderRow): O.DietOrder {
  return {
    id: r.id,
    facilityId: r.facilityId,
    patientId: r.patientId,
    patientName: r.patientName,
    patientUhid: r.patientUhid,
    location: r.location,
    dietType: r.dietType as O.DietType,
    vegetarian: r.vegetarian,
    instructions: r.instructions,
    allergies: r.allergies,
    startDate: r.startDate,
    endDate: r.endDate,
    status: r.status as O.DietOrder['status'],
    orderedBy: r.orderedBy,
    createdAt: iso(r.createdAt),
  };
}
