import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  portalAccountPatients,
  portalAccounts,
  portalAppointments,
  portalFeedback,
  portalInvoices,
  portalOtpChallenges,
  portalPaymentIntents,
  portalPrescriptions,
  portalProcessedEvents,
  portalReports,
  portalSessions,
  sql,
  type Tx,
} from '@hms/db';

export type AccountRow = typeof portalAccounts.$inferSelect;
export type SessionRow = typeof portalSessions.$inferSelect;
export type AppointmentRow = typeof portalAppointments.$inferSelect;
export type NewAppointmentRow = typeof portalAppointments.$inferInsert;
export type PrescriptionRow = typeof portalPrescriptions.$inferSelect;
export type InvoiceRow = typeof portalInvoices.$inferSelect;
export type ReportRow = typeof portalReports.$inferSelect;
export type PaymentIntentRow = typeof portalPaymentIntents.$inferSelect;
export type FeedbackRow = typeof portalFeedback.$inferSelect;

/** Drizzle queries for the portal schema. Always called inside a tenant transaction. */
@Injectable()
export class PortalRepository {
  // ---------- OTP ----------

  async countRecentChallenges(tx: Tx, mobile: string, minutes: number): Promise<number> {
    const [row] = await tx
      .select({ n: count() })
      .from(portalOtpChallenges)
      .where(and(eq(portalOtpChallenges.mobile, mobile), sql`${portalOtpChallenges.createdAt} > now() - make_interval(mins => ${minutes})`));
    return row?.n ?? 0;
  }

  async insertChallenge(tx: Tx, v: typeof portalOtpChallenges.$inferInsert) {
    const [row] = await tx.insert(portalOtpChallenges).values(v).returning();
    return row!;
  }

  async latestOpenChallenge(tx: Tx, mobile: string) {
    const [row] = await tx
      .select()
      .from(portalOtpChallenges)
      .where(and(eq(portalOtpChallenges.mobile, mobile), sql`${portalOtpChallenges.consumedAt} is null`))
      .orderBy(desc(portalOtpChallenges.createdAt))
      .limit(1);
    return row;
  }

  async updateChallenge(tx: Tx, id: string, v: Partial<typeof portalOtpChallenges.$inferInsert>) {
    await tx.update(portalOtpChallenges).set(v).where(eq(portalOtpChallenges.id, id));
  }

  // ---------- accounts & sessions ----------

  async upsertAccountOnLogin(tx: Tx, tenantId: string, mobile: string): Promise<AccountRow> {
    const [row] = await tx
      .insert(portalAccounts)
      .values({ tenantId, mobile, lastLoginAt: sql`now()` as unknown as string })
      .onConflictDoUpdate({ target: [portalAccounts.tenantId, portalAccounts.mobile], set: { lastLoginAt: sql`now()` } })
      .returning();
    return row!;
  }

  async findAccount(tx: Tx, id: string): Promise<AccountRow | undefined> {
    const [row] = await tx.select().from(portalAccounts).where(eq(portalAccounts.id, id)).limit(1);
    return row;
  }

  async updateAccount(tx: Tx, id: string, v: Partial<typeof portalAccounts.$inferInsert>): Promise<AccountRow | undefined> {
    const [row] = await tx.update(portalAccounts).set(v).where(eq(portalAccounts.id, id)).returning();
    return row;
  }

  async insertSession(tx: Tx, v: typeof portalSessions.$inferInsert): Promise<SessionRow> {
    const [row] = await tx.insert(portalSessions).values(v).returning();
    return row!;
  }

  async findSession(tx: Tx, id: string): Promise<SessionRow | undefined> {
    const [row] = await tx.select().from(portalSessions).where(eq(portalSessions.id, id)).limit(1);
    return row;
  }

  async updateSession(tx: Tx, id: string, v: Partial<typeof portalSessions.$inferInsert>) {
    await tx.update(portalSessions).set(v).where(eq(portalSessions.id, id));
  }

  // ---------- linked patients ----------

  async links(tx: Tx, accountId: string) {
    return tx
      .select()
      .from(portalAccountPatients)
      .where(eq(portalAccountPatients.accountId, accountId))
      .orderBy(asc(portalAccountPatients.createdAt));
  }

  async link(tx: Tx, v: typeof portalAccountPatients.$inferInsert): Promise<void> {
    await tx.insert(portalAccountPatients).values(v).onConflictDoNothing();
  }

  // ---------- appointments ----------

  async insertAppointment(tx: Tx, v: NewAppointmentRow): Promise<AppointmentRow> {
    const [row] = await tx.insert(portalAppointments).values(v).returning();
    return row!;
  }

  async findAppointment(tx: Tx, id: string): Promise<AppointmentRow | undefined> {
    const [row] = await tx.select().from(portalAppointments).where(eq(portalAppointments.id, id)).limit(1);
    return row;
  }

  async findAppointmentBySource(tx: Tx, appointmentId: string): Promise<AppointmentRow | undefined> {
    const [row] = await tx.select().from(portalAppointments).where(eq(portalAppointments.appointmentId, appointmentId)).limit(1);
    return row;
  }

  /** A portal booking not yet tied to a front office appointment, for the same patient, doctor and slot. */
  async findUnlinkedPortalBooking(tx: Tx, patientId: string, doctorId: string, slotStart: string) {
    const [row] = await tx
      .select()
      .from(portalAppointments)
      .where(
        and(
          eq(portalAppointments.patientId, patientId),
          eq(portalAppointments.doctorId, doctorId),
          sql`${portalAppointments.slotStart} = ${slotStart}::timestamptz`,
          eq(portalAppointments.source, 'portal'),
          sql`${portalAppointments.appointmentId} is null`,
        ),
      )
      .limit(1);
    return row;
  }

  async updateAppointment(tx: Tx, id: string, v: Partial<NewAppointmentRow>): Promise<AppointmentRow | undefined> {
    const [row] = await tx.update(portalAppointments).set(v).where(eq(portalAppointments.id, id)).returning();
    return row;
  }

  async listAppointments(tx: Tx, patientIds: string[], scope: 'upcoming' | 'past' | 'all') {
    const when =
      scope === 'upcoming'
        ? sql`${portalAppointments.slotStart} >= now() - interval '1 hour'`
        : scope === 'past'
          ? sql`${portalAppointments.slotStart} < now() - interval '1 hour'`
          : undefined;
    return tx
      .select()
      .from(portalAppointments)
      .where(and(inArray(portalAppointments.patientId, patientIds), when))
      .orderBy(scope === 'upcoming' ? asc(portalAppointments.slotStart) : desc(portalAppointments.slotStart))
      .limit(200);
  }

  /** Slot starts already taken by live portal bookings for a doctor on [from, to). */
  async takenSlots(tx: Tx, doctorId: string, from: string, to: string): Promise<Set<number>> {
    const rows = await tx
      .select({ slotStart: portalAppointments.slotStart })
      .from(portalAppointments)
      .where(
        and(
          eq(portalAppointments.doctorId, doctorId),
          inArray(portalAppointments.status, ['requested', 'booked', 'confirmed']),
          sql`${portalAppointments.slotStart} >= ${from}::timestamptz and ${portalAppointments.slotStart} < ${to}::timestamptz`,
        ),
      );
    return new Set(rows.map((r) => new Date(r.slotStart).getTime()));
  }

  async staffListAppointments(tx: Tx, f: { status?: string; date?: string }, page: number, pageSize: number) {
    const filter = and(
      eq(portalAppointments.source, 'portal'),
      f.status ? eq(portalAppointments.status, f.status) : undefined,
      f.date ? sql`(${portalAppointments.slotStart} at time zone 'Asia/Kolkata')::date = ${f.date}::date` : undefined,
    );
    const [items, [total]] = await Promise.all([
      tx.select().from(portalAppointments).where(filter).orderBy(asc(portalAppointments.slotStart)).limit(pageSize).offset((page - 1) * pageSize),
      tx.select({ n: count() }).from(portalAppointments).where(filter),
    ]);
    return { items, total: total?.n ?? 0 };
  }

  // ---------- records ----------

  listPrescriptions(tx: Tx, patientIds: string[]) {
    return tx
      .select()
      .from(portalPrescriptions)
      .where(inArray(portalPrescriptions.patientId, patientIds))
      .orderBy(desc(portalPrescriptions.issuedAt))
      .limit(200);
  }

  listInvoices(tx: Tx, patientIds: string[]) {
    return tx.select().from(portalInvoices).where(inArray(portalInvoices.patientId, patientIds)).orderBy(desc(portalInvoices.issuedAt)).limit(200);
  }

  async findInvoiceBySource(tx: Tx, invoiceId: string): Promise<InvoiceRow | undefined> {
    const [row] = await tx.select().from(portalInvoices).where(eq(portalInvoices.invoiceId, invoiceId)).limit(1);
    return row;
  }

  listReports(tx: Tx, patientIds: string[]) {
    return tx.select().from(portalReports).where(inArray(portalReports.patientId, patientIds)).orderBy(desc(portalReports.issuedAt)).limit(200);
  }

  // ---------- payments ----------

  async insertIntent(tx: Tx, v: typeof portalPaymentIntents.$inferInsert): Promise<PaymentIntentRow> {
    const [row] = await tx.insert(portalPaymentIntents).values(v).returning();
    return row!;
  }

  async findIntent(tx: Tx, id: string): Promise<PaymentIntentRow | undefined> {
    const [row] = await tx.select().from(portalPaymentIntents).where(eq(portalPaymentIntents.id, id)).limit(1);
    return row;
  }

  async updateIntent(tx: Tx, id: string, v: Partial<typeof portalPaymentIntents.$inferInsert>) {
    const [row] = await tx.update(portalPaymentIntents).set(v).where(eq(portalPaymentIntents.id, id)).returning();
    return row;
  }

  /** Online payments captured here that billing has not yet recorded, per invoice. */
  async unsettledPaid(tx: Tx, invoiceIds: string[]): Promise<Map<string, number>> {
    if (!invoiceIds.length) return new Map();
    const rows = await tx
      .select({ invoiceId: portalPaymentIntents.invoiceId, amount: sql<string>`sum(${portalPaymentIntents.amount})` })
      .from(portalPaymentIntents)
      .where(
        and(
          inArray(portalPaymentIntents.invoiceId, invoiceIds),
          eq(portalPaymentIntents.status, 'paid'),
          sql`${portalPaymentIntents.settledAt} is null`,
        ),
      )
      .groupBy(portalPaymentIntents.invoiceId);
    return new Map(rows.map((r) => [r.invoiceId, Number(r.amount)]));
  }

  // ---------- feedback ----------

  async insertFeedback(tx: Tx, v: typeof portalFeedback.$inferInsert): Promise<FeedbackRow> {
    const [row] = await tx.insert(portalFeedback).values(v).returning();
    return row!;
  }

  async listFeedback(tx: Tx, page: number, pageSize: number) {
    const [items, [summary]] = await Promise.all([
      tx.select().from(portalFeedback).orderBy(desc(portalFeedback.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
      tx.select({ n: count(), avg: sql<string | null>`avg(${portalFeedback.rating})` }).from(portalFeedback),
    ]);
    return { items, total: summary?.n ?? 0, average: summary?.avg == null ? null : Math.round(Number(summary.avg) * 10) / 10 };
  }

  // ---------- events ----------

  /** Records an event id; false if it was already applied. */
  async markProcessed(tx: Tx, tenantId: string, eventId: string, topic: string): Promise<boolean> {
    const rows = await tx.insert(portalProcessedEvents).values({ tenantId, eventId, topic }).onConflictDoNothing().returning();
    return rows.length > 0;
  }
}
