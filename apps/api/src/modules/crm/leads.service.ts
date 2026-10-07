import { Injectable } from '@nestjs/common';
import {
  and,
  count,
  crmCamps,
  crmLeadActivities,
  crmLeads,
  crmReferrers,
  desc,
  eq,
  formatSeries,
  inArray,
  iso,
  nextCounter,
  or,
  sql,
  users,
  type Tx,
} from '@hms/db';
import { crm, type Paginated } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { OutboxService } from '../../common/events/outbox.service';
import { currentContext } from '../../common/context/request-context';
import { conflict, notFound } from '../../common/errors/errors';
import { PatientsService } from '../patients/patients.service';
import { ReferralsService } from './referrals.service';
import { actor, tenantId } from './crm.util';

type LeadRow = typeof crmLeads.$inferSelect;

const OPEN = crm.OPEN_LEAD_STATUSES as readonly string[];

/** Enquiries (leads): capture, work (calls, notes, next follow-up), convert to a patient or close as lost. */
@Injectable()
export class LeadsService {
  constructor(
    private readonly db: DbService,
    private readonly outbox: OutboxService,
    private readonly patients: PatientsService,
    private readonly referrals: ReferralsService,
  ) {}

  list(q: crm.LeadQuery): Promise<Paginated<crm.Lead>> {
    const { page, pageSize, q: term, status, source, campId, assignedTo, due } = crm.leadQuerySchema.parse(q);
    return this.db.tx(async (tx) => {
      const t = term?.toLowerCase();
      const where = and(
        status === 'open' ? inArray(crmLeads.status, [...OPEN]) : status ? eq(crmLeads.status, status) : undefined,
        source ? eq(crmLeads.source, source) : undefined,
        campId ? eq(crmLeads.campId, campId) : undefined,
        assignedTo ? eq(crmLeads.assignedTo, assignedTo) : undefined,
        due === 'true' ? and(inArray(crmLeads.status, [...OPEN]), sql`${crmLeads.nextFollowUpAt} <= now()`) : undefined,
        t
          ? or(
              sql`lower(${crmLeads.name}) like ${'%' + t + '%'}`,
              sql`${crmLeads.mobile} like ${t + '%'}`,
              sql`lower(${crmLeads.number}) = ${t}`,
              sql`lower(coalesce(${crmLeads.email}, '')) = ${t}`,
            )
          : undefined,
      );
      const order = due === 'true' ? [sql`${crmLeads.nextFollowUpAt} asc`] : [desc(crmLeads.createdAt)];
      const [rows, [{ total }]] = await Promise.all([
        this.leadQuery(tx).where(where).orderBy(...order).limit(pageSize).offset((page - 1) * pageSize),
        tx.select({ total: count() }).from(crmLeads).where(where),
      ]);
      return { items: rows.map(leadDto), page, pageSize, total };
    });
  }

  get(id: string): Promise<crm.LeadDetail> {
    return this.db.tx((tx) => this.detail(tx, id));
  }

  create(input: crm.LeadInput): Promise<crm.LeadDetail> {
    const d = crm.leadInputSchema.parse(input);
    return this.db.tx(async (tx) => {
      await this.checkLinks(tx, d.referrerId, d.campId);
      const number = formatSeries('LD', await nextCounter(tx, 'crm.lead'));
      const source = d.campId && d.source === 'walk_in' ? 'camp' : d.source;
      const [row] = await tx
        .insert(crmLeads)
        .values({
          ...d,
          source,
          tenantId: tenantId(),
          number,
          facilityId: currentContext()?.facilityId ?? null,
          createdBy: actor(),
          updatedBy: actor(),
        })
        .returning();
      return this.detail(tx, row!.id);
    });
  }

  update(id: string, input: crm.UpdateLead): Promise<crm.LeadDetail> {
    const d = crm.updateLeadSchema.parse(input);
    return this.db.tx(async (tx) => {
      const lead = await this.row(tx, id);
      if (!OPEN.includes(lead.status) && Object.keys(d).some((k) => k !== 'notes')) {
        throw conflict('lead_closed', `This enquiry is ${lead.status}; only notes can change`);
      }
      await this.checkLinks(tx, d.referrerId, d.campId);
      const mobile = d.mobile === undefined ? lead.mobile : d.mobile;
      const email = d.email === undefined ? lead.email : d.email;
      if (!mobile && !email) throw conflict('lead_contact_required', 'Keep a mobile number or an email');
      await tx
        .update(crmLeads)
        .set({ ...d, updatedBy: actor() })
        .where(eq(crmLeads.id, id));
      return this.detail(tx, id);
    });
  }

  addActivity(id: string, input: crm.LeadActivityInput): Promise<crm.LeadDetail> {
    const d = crm.leadActivityInputSchema.parse(input);
    return this.db.tx(async (tx) => {
      const lead = await this.row(tx, id);
      if (!OPEN.includes(lead.status)) throw conflict('lead_closed', `This enquiry is ${lead.status}`);
      await tx.insert(crmLeadActivities).values({ tenantId: tenantId(), leadId: id, type: d.type, note: d.note, createdBy: actor() });
      // Any contact moves a new lead to 'contacted' unless a status was given.
      const next = d.status ?? (lead.status === 'new' && d.type !== 'note' ? 'contacted' : lead.status);
      if (next !== lead.status) await this.logStatus(tx, id, lead.status, next);
      await tx
        .update(crmLeads)
        .set({ status: next, ...(d.nextFollowUpAt !== undefined ? { nextFollowUpAt: d.nextFollowUpAt } : {}), updatedBy: actor() })
        .where(eq(crmLeads.id, id));
      return this.detail(tx, id);
    });
  }

  lose(id: string, input: crm.LoseLead): Promise<crm.LeadDetail> {
    const d = crm.loseLeadSchema.parse(input);
    return this.db.tx(async (tx) => {
      const lead = await this.row(tx, id);
      if (!OPEN.includes(lead.status)) throw conflict('lead_closed', `This enquiry is already ${lead.status}`);
      await this.logStatus(tx, id, lead.status, 'lost', d.reason);
      await tx.update(crmLeads).set({ status: 'lost', lostReason: d.reason, nextFollowUpAt: null, updatedBy: actor() }).where(eq(crmLeads.id, id));
      return this.detail(tx, id);
    });
  }

  reopen(id: string): Promise<crm.LeadDetail> {
    return this.db.tx(async (tx) => {
      const lead = await this.row(tx, id);
      if (lead.status !== 'lost') throw conflict('lead_not_lost', 'Only lost enquiries can be reopened');
      await this.logStatus(tx, id, 'lost', 'contacted');
      await tx.update(crmLeads).set({ status: 'contacted', lostReason: null, updatedBy: actor() }).where(eq(crmLeads.id, id));
      return this.detail(tx, id);
    });
  }

  /**
   * Turn an enquiry into a patient: link an existing patient or register one through PatientsService.
   * A lead with a referrer also gets a referral, so the referrer's commission starts.
   */
  async convert(id: string, input: crm.ConvertLead): Promise<crm.LeadDetail> {
    const d = crm.convertLeadSchema.parse(input);
    const before = await this.db.tx((tx) => this.row(tx, id));
    if (!OPEN.includes(before.status)) throw conflict('lead_closed', `This enquiry is already ${before.status}`);

    // Registration runs in PatientsService's own transaction (it owns UHID numbering).
    const patientId =
      d.patientId ??
      (
        await this.patients.create({
          firstName: d.register!.firstName,
          lastName: d.register!.lastName ?? undefined,
          gender: d.register!.gender,
          ageYears: d.register!.ageYears ?? before.ageYears ?? undefined,
          mobile: d.register!.mobile ?? before.mobile ?? undefined,
          email: before.email ?? undefined,
        })
      ).id;
    if (d.patientId) await this.patients.get(d.patientId);

    return this.db.tx(async (tx) => {
      const lead = await this.row(tx, id, true);
      if (!OPEN.includes(lead.status)) throw conflict('lead_closed', `This enquiry is already ${lead.status}`);
      await this.logStatus(tx, id, lead.status, 'converted');
      await tx
        .update(crmLeads)
        .set({ status: 'converted', patientId, convertedAt: new Date().toISOString(), nextFollowUpAt: null, updatedBy: actor() })
        .where(eq(crmLeads.id, id));
      if (lead.referrerId) {
        const [ref] = await tx.select({ isActive: crmReferrers.isActive }).from(crmReferrers).where(eq(crmReferrers.id, lead.referrerId));
        if (ref?.isActive) await this.referrals.createReferralIn(tx, { patientId, referrerId: lead.referrerId, leadId: id, notes: `From enquiry ${lead.number}` });
      }
      const event: crm.LeadConvertedEvent = {
        leadId: id,
        patientId,
        source: lead.source as crm.LeadSource,
        referrerId: lead.referrerId,
        campId: lead.campId,
      };
      await this.outbox.publish(tx, 'crm.lead.converted', { ...event });
      return this.detail(tx, id);
    });
  }

  // ---------- internals ----------

  private async checkLinks(tx: Tx, referrerId?: string | null, campId?: string | null) {
    if (referrerId) {
      const [r] = await tx.select({ id: crmReferrers.id }).from(crmReferrers).where(eq(crmReferrers.id, referrerId));
      if (!r) throw notFound('Referrer');
    }
    if (campId) {
      const [c] = await tx.select({ id: crmCamps.id }).from(crmCamps).where(eq(crmCamps.id, campId));
      if (!c) throw notFound('Camp');
    }
  }

  private async logStatus(tx: Tx, leadId: string, from: string, to: string, note?: string) {
    await tx.insert(crmLeadActivities).values({ tenantId: tenantId(), leadId, type: 'status_change', fromStatus: from, toStatus: to, note: note ?? null, createdBy: actor() });
  }

  private async row(tx: Tx, id: string, lock = false): Promise<LeadRow> {
    const q = tx.select().from(crmLeads).where(eq(crmLeads.id, id)).limit(1);
    const [row] = lock ? await q.for('update') : await q;
    if (!row) throw notFound('Enquiry');
    return row;
  }

  private leadQuery(tx: Tx) {
    return tx
      .select({ l: crmLeads, referrerName: crmReferrers.name, campName: crmCamps.name, assignedToName: users.name })
      .from(crmLeads)
      .leftJoin(crmReferrers, and(eq(crmReferrers.tenantId, crmLeads.tenantId), eq(crmReferrers.id, crmLeads.referrerId)))
      .leftJoin(crmCamps, and(eq(crmCamps.tenantId, crmLeads.tenantId), eq(crmCamps.id, crmLeads.campId)))
      .leftJoin(users, and(eq(users.tenantId, crmLeads.tenantId), eq(users.id, crmLeads.assignedTo)));
  }

  private async detail(tx: Tx, id: string): Promise<crm.LeadDetail> {
    const [row] = await this.leadQuery(tx).where(eq(crmLeads.id, id)).limit(1);
    if (!row) throw notFound('Enquiry');
    const acts = await tx
      .select({ a: crmLeadActivities, name: users.name })
      .from(crmLeadActivities)
      .leftJoin(users, and(eq(users.tenantId, crmLeadActivities.tenantId), eq(users.id, crmLeadActivities.createdBy)))
      .where(eq(crmLeadActivities.leadId, id))
      .orderBy(desc(crmLeadActivities.createdAt), desc(crmLeadActivities.id));
    return {
      ...leadDto(row),
      activities: acts.map(({ a, name }) => ({
        id: a.id,
        type: a.type as crm.ActivityType,
        note: a.note,
        fromStatus: a.fromStatus as crm.LeadStatus | null,
        toStatus: a.toStatus as crm.LeadStatus | null,
        createdBy: a.createdBy,
        createdByName: name,
        createdAt: iso(a.createdAt),
      })),
    };
  }
}

function leadDto(x: { l: LeadRow; referrerName: string | null; campName: string | null; assignedToName: string | null }): crm.Lead {
  const l = x.l;
  return {
    id: l.id,
    number: l.number,
    name: l.name,
    mobile: l.mobile,
    email: l.email,
    gender: l.gender as crm.Lead['gender'],
    ageYears: l.ageYears,
    city: l.city,
    source: l.source as crm.LeadSource,
    interest: l.interest,
    notes: l.notes,
    status: l.status as crm.LeadStatus,
    lostReason: l.lostReason,
    assignedTo: l.assignedTo,
    assignedToName: x.assignedToName,
    nextFollowUpAt: l.nextFollowUpAt ? iso(l.nextFollowUpAt) : null,
    referrerId: l.referrerId,
    referrerName: x.referrerName,
    campId: l.campId,
    campName: x.campName,
    campaignId: l.campaignId,
    patientId: l.patientId,
    convertedAt: l.convertedAt ? iso(l.convertedAt) : null,
    createdAt: iso(l.createdAt),
    updatedAt: iso(l.updatedAt),
  };
}
