import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { and, count, crmFollowUps, crmLeads, desc, eq, iso, patients, sql, tenants, users, type Tx } from '@hms/db';
import { crm, type Paginated } from '@hms/shared';
import { APP_CONFIG, type AppConfig } from '../../config';
import { DbService } from '../../common/db/db.service';
import { currentContext } from '../../common/context/request-context';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { CrmMessenger } from './crm.messenger';
import { actor, addDays, checkAssignee, personName, tenantId, todayIST } from './crm.util';

type FollowUpRow = typeof crmFollowUps.$inferSelect;

/** How often the automatic reminder sweep runs (it is idempotent per follow-up per day). */
const SWEEP_EVERY_MS = 60 * 60 * 1000;
/** Reminders go out from this hour (IST) on the day before the follow-up. */
const SWEEP_FROM_HOUR_IST = 9;

const TYPE_TEXT: Record<crm.FollowUpType, string> = {
  revisit: 'follow-up visit',
  call: 'follow-up call',
  feedback_recovery: 'call from our patient care team',
  test_review: 'test report review',
  other: 'follow-up',
};

/**
 * Patient (and enquiry) follow-up reminders: created by staff, from the doctor's follow-up date on a signed
 * consultation, or from a low portal rating. Reminders go out through NotificationsService.
 */
@Injectable()
export class FollowUpsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(FollowUpsService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: DbService,
    private readonly messenger: CrmMessenger,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap() {
    if (this.config.NODE_ENV === 'test') return;
    const run = () => {
      const hour = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }));
      if (hour < SWEEP_FROM_HOUR_IST) return;
      this.sweepAllHospitals().catch((e: Error) => this.logger.error(`follow-up reminders: ${e.message}`));
    };
    this.timer = setInterval(run, SWEEP_EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  list(q: crm.FollowUpQuery): Promise<Paginated<crm.FollowUp>> {
    const { page, pageSize, status, when, patientId, type, source } = crm.followUpQuerySchema.parse(q);
    return this.db.tx(async (tx) => {
      const today = todayIST();
      const where = and(
        status ? eq(crmFollowUps.status, status) : undefined,
        when ? eq(crmFollowUps.status, 'pending') : undefined,
        when === 'overdue' ? sql`${crmFollowUps.dueDate} < ${today}` : undefined,
        when === 'today' ? eq(crmFollowUps.dueDate, today) : undefined,
        when === 'upcoming' ? sql`${crmFollowUps.dueDate} > ${today}` : undefined,
        patientId ? eq(crmFollowUps.patientId, patientId) : undefined,
        type ? eq(crmFollowUps.type, type) : undefined,
        source ? eq(crmFollowUps.source, source) : undefined,
      );
      const order = status && status !== 'pending' ? [desc(crmFollowUps.updatedAt)] : [crmFollowUps.dueDate, crmFollowUps.createdAt];
      const [rows, [{ total }]] = await Promise.all([
        this.query(tx).where(where).orderBy(...order).limit(pageSize).offset((page - 1) * pageSize),
        tx.select({ total: count() }).from(crmFollowUps).where(where),
      ]);
      return { items: rows.map(dto), page, pageSize, total };
    });
  }

  get(id: string): Promise<crm.FollowUp> {
    return this.db.tx((tx) => this.detail(tx, id));
  }

  create(input: crm.FollowUpInput): Promise<crm.FollowUp> {
    const d = crm.followUpInputSchema.parse(input);
    if (d.dueDate < todayIST()) throw badRequest('due_date_past', 'The due date cannot be in the past');
    return this.db.tx(async (tx) => {
      await checkAssignee(tx, d.assignedTo);
      if (d.patientId) {
        const [p] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, d.patientId));
        if (!p) throw notFound('Patient');
      }
      if (d.leadId) {
        const [l] = await tx.select({ patientId: crmLeads.patientId }).from(crmLeads).where(eq(crmLeads.id, d.leadId));
        if (!l) throw notFound('Enquiry');
      }
      const [row] = await tx
        .insert(crmFollowUps)
        .values({
          tenantId: tenantId(),
          facilityId: currentContext()?.facilityId ?? null,
          patientId: d.patientId ?? null,
          leadId: d.leadId ?? null,
          dueDate: d.dueDate,
          type: d.type,
          reason: d.reason,
          assignedTo: d.assignedTo,
          source: 'manual',
          createdBy: actor(),
          updatedBy: actor(),
        })
        .returning({ id: crmFollowUps.id });
      return this.detail(tx, row!.id);
    });
  }

  update(id: string, input: crm.UpdateFollowUp): Promise<crm.FollowUp> {
    const d = crm.updateFollowUpSchema.parse(input);
    return this.db.tx(async (tx) => {
      const f = await this.row(tx, id);
      if (f.status !== 'pending') throw conflict('follow_up_closed', `This follow-up is already ${f.status}`);
      if (d.dueDate && d.dueDate !== f.dueDate && d.dueDate < todayIST()) throw badRequest('due_date_past', 'The due date cannot be in the past');
      await checkAssignee(tx, d.assignedTo);
      await tx.update(crmFollowUps).set({ ...d, updatedBy: actor() }).where(eq(crmFollowUps.id, id));
      return this.detail(tx, id);
    });
  }

  close(id: string, input: crm.CloseFollowUp): Promise<crm.FollowUp> {
    const d = crm.closeFollowUpSchema.parse(input);
    return this.db.tx(async (tx) => {
      const f = await this.row(tx, id);
      if (f.status !== 'pending') throw conflict('follow_up_closed', `This follow-up is already ${f.status}`);
      await tx
        .update(crmFollowUps)
        .set({ status: d.status, outcome: d.outcome, completedAt: new Date().toISOString(), completedBy: actor(), updatedBy: actor() })
        .where(eq(crmFollowUps.id, id));
      return this.detail(tx, id);
    });
  }

  /** Send a reminder now (staff clicked "Remind"). */
  remind(id: string, input: crm.RemindFollowUp): Promise<crm.FollowUp & { queued: number; reason: string | null }> {
    const d = crm.remindFollowUpSchema.parse(input);
    return this.db.tx(async (tx) => {
      const [x] = await this.query(tx).where(eq(crmFollowUps.id, id)).limit(1);
      if (!x) throw notFound('Follow-up');
      if (x.f.status !== 'pending') throw conflict('follow_up_closed', `This follow-up is already ${x.f.status}`);
      const outcome = await this.sendReminder(tx, x, d.channels ?? ['sms'], d.message ?? undefined, `manual:${Date.now()}`);
      return { ...(await this.detail(tx, id)), queued: outcome.queued, reason: outcome.reason };
    });
  }

  /** Remind every pending follow-up due on `date` (default: tomorrow) that has not been reminded today. */
  remindDue(date?: string): Promise<crm.RemindDueResult> {
    const day = date ?? addDays(todayIST(), 1);
    return this.db.tx((tx) => this.remindDueIn(tx, day));
  }

  /** Hourly in the API: tomorrow's follow-ups for every active hospital. */
  async sweepAllHospitals(): Promise<void> {
    const list = await this.db.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.status, 'active'));
    const day = addDays(todayIST(), 1);
    for (const t of list) {
      await this.db.asTenant({ tenantId: t.id }, (tx) => this.remindDueIn(tx, day)).catch((e: Error) => this.logger.warn(`tenant ${t.id}: ${e.message}`));
    }
  }

  private async remindDueIn(tx: Tx, day: string): Promise<crm.RemindDueResult> {
    const today = todayIST();
    const rows = await this.query(tx)
      .where(
        and(
          eq(crmFollowUps.status, 'pending'),
          eq(crmFollowUps.dueDate, day),
          sql`(${crmFollowUps.lastRemindedAt} is null or (${crmFollowUps.lastRemindedAt} at time zone 'Asia/Kolkata')::date < ${today}::date)`,
        ),
      )
      .limit(1000);
    let reminded = 0;
    let skipped = 0;
    for (const x of rows) {
      const outcome = await this.sendReminder(tx, x, ['sms'], undefined, `auto:${today}`);
      if (outcome.queued > 0) reminded++;
      else skipped++;
    }
    return { date: day, reminded, skipped };
  }

  private async sendReminder(tx: Tx, x: QueryRow, channels: crm.CampaignChannel[], custom: string | undefined, key: string) {
    const f = x.f;
    const name = x.firstName ? personName(x.firstName, x.lastName) : (x.leadName ?? undefined);
    const to = f.patientId ? { patientId: f.patientId } : x.leadMobile ? { mobile: x.leadMobile } : x.leadEmail ? { email: x.leadEmail } : null;
    const when = new Date(`${f.dueDate}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const message = custom ?? `Dear ${name ?? 'patient'}, your ${TYPE_TEXT[f.type as crm.FollowUpType]} is due on ${when}. Please call us to book a convenient time.`;
    const outcome = to
      ? await this.messenger.send(tx, { to, name, message, channels, idempotencyKey: `crm.followup:${f.id}:${key}`, refId: f.id })
      : { queued: 0, skipped: 1, reason: 'no_address' };
    if (outcome.queued > 0) {
      await tx
        .update(crmFollowUps)
        .set({ reminderCount: sql`${crmFollowUps.reminderCount} + 1`, lastRemindedAt: new Date().toISOString() })
        .where(eq(crmFollowUps.id, f.id));
    }
    return outcome;
  }

  // ---------- created from other modules' events (worker; idempotent via the source unique index) ----------

  async fromEncounter(tx: Tx, tenant: string, e: { encounterId: string; patientId: string; doctorId: string; followUpDate?: string | null; followUpNotes?: string | null }) {
    if (!e.followUpDate) return;
    await tx
      .insert(crmFollowUps)
      .values({
        tenantId: tenant,
        patientId: e.patientId,
        dueDate: e.followUpDate,
        type: 'revisit',
        reason: e.followUpNotes ?? 'Follow-up advised by the doctor',
        source: 'emr',
        sourceRef: e.encounterId,
        assignedTo: null,
      })
      .onConflictDoNothing();
  }

  async fromFeedback(tx: Tx, tenant: string, e: { feedbackId: string; patientId: string; rating: number }) {
    if (e.rating > crm.LOW_FEEDBACK_RATING) return;
    await tx
      .insert(crmFollowUps)
      .values({
        tenantId: tenant,
        patientId: e.patientId,
        dueDate: todayIST(),
        type: 'feedback_recovery',
        reason: `Patient rated us ${e.rating}/5 on the portal. Call to understand and resolve.`,
        source: 'feedback',
        sourceRef: e.feedbackId,
      })
      .onConflictDoNothing();
  }

  // ---------- internals ----------

  private async row(tx: Tx, id: string): Promise<FollowUpRow> {
    const [row] = await tx.select().from(crmFollowUps).where(eq(crmFollowUps.id, id)).for('update').limit(1);
    if (!row) throw notFound('Follow-up');
    return row;
  }

  private query(tx: Tx) {
    return tx
      .select({
        f: crmFollowUps,
        firstName: patients.firstName,
        lastName: patients.lastName,
        uhid: patients.uhid,
        patientMobile: patients.mobile,
        leadName: crmLeads.name,
        leadMobile: crmLeads.mobile,
        leadEmail: crmLeads.email,
        assignedToName: users.name,
      })
      .from(crmFollowUps)
      .leftJoin(patients, and(eq(patients.tenantId, crmFollowUps.tenantId), eq(patients.id, crmFollowUps.patientId)))
      .leftJoin(crmLeads, and(eq(crmLeads.tenantId, crmFollowUps.tenantId), eq(crmLeads.id, crmFollowUps.leadId)))
      .leftJoin(users, and(eq(users.tenantId, crmFollowUps.tenantId), eq(users.id, crmFollowUps.assignedTo)));
  }

  private async detail(tx: Tx, id: string): Promise<crm.FollowUp> {
    const [x] = await this.query(tx).where(eq(crmFollowUps.id, id)).limit(1);
    if (!x) throw notFound('Follow-up');
    return dto(x);
  }
}

type QueryRow = {
  f: FollowUpRow;
  firstName: string | null;
  lastName: string | null;
  uhid: string | null;
  patientMobile: string | null;
  leadName: string | null;
  leadMobile: string | null;
  leadEmail: string | null;
  assignedToName: string | null;
};

function dto(x: QueryRow): crm.FollowUp {
  const f = x.f;
  return {
    id: f.id,
    patientId: f.patientId,
    patientName: x.firstName ? personName(x.firstName, x.lastName) : null,
    patientUhid: x.uhid,
    patientMobile: x.patientMobile,
    leadId: f.leadId,
    leadName: x.leadName,
    dueDate: f.dueDate,
    type: f.type as crm.FollowUpType,
    reason: f.reason,
    source: f.source as crm.FollowUpSource,
    sourceRef: f.sourceRef,
    status: f.status as crm.FollowUpStatus,
    assignedTo: f.assignedTo,
    assignedToName: x.assignedToName,
    reminderCount: f.reminderCount,
    lastRemindedAt: f.lastRemindedAt ? iso(f.lastRemindedAt) : null,
    outcome: f.outcome,
    completedAt: f.completedAt ? iso(f.completedAt) : null,
    createdAt: iso(f.createdAt),
  };
}
