import { Injectable } from '@nestjs/common';
import {
  and,
  count,
  crmCampaignRecipients,
  crmCampaigns,
  crmCamps,
  crmLeads,
  desc,
  eq,
  formatSeries,
  inArray,
  iso,
  nextCounter,
  sql,
  type CrmCampaignAudience,
  type Tx,
} from '@hms/db';
import { crm, type Paginated } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { CrmMessenger } from './crm.messenger';
import { actor, moneyString, tenantId, toNumberOrNull } from './crm.util';

type CampRow = typeof crmCamps.$inferSelect;
type CampaignRow = typeof crmCampaigns.$inferSelect;

/** Most leads one campaign send may reach (bigger lists go through the notifications module's bulk tools later). */
export const CAMPAIGN_MAX_RECIPIENTS = 5000;

/** Health camps and message campaigns to enquiries. */
@Injectable()
export class CampsService {
  constructor(
    private readonly db: DbService,
    private readonly messenger: CrmMessenger,
  ) {}

  // =====================================================================
  // Camps
  // =====================================================================

  listCamps(q: crm.CampQuery): Promise<Paginated<crm.Camp>> {
    const { page, pageSize, status } = crm.campQuerySchema.parse(q);
    return this.db.tx(async (tx) => {
      const where = status ? eq(crmCamps.status, status) : undefined;
      const [rows, [{ total }]] = await Promise.all([
        tx.select().from(crmCamps).where(where).orderBy(desc(crmCamps.startsOn)).limit(pageSize).offset((page - 1) * pageSize),
        tx.select({ total: count() }).from(crmCamps).where(where),
      ]);
      const stats = await this.campStats(tx, rows.map((r) => r.id));
      return { items: rows.map((r) => campDto(r, stats.get(r.id))), page, pageSize, total };
    });
  }

  getCamp(id: string): Promise<crm.Camp> {
    return this.db.tx((tx) => this.campDetail(tx, id));
  }

  createCamp(input: crm.CampInput): Promise<crm.Camp> {
    const d = crm.campInputSchema.parse(input);
    return this.db.tx(async (tx) => {
      const code = formatSeries('CMP', await nextCounter(tx, 'crm.camp'), 4);
      const [row] = await tx
        .insert(crmCamps)
        .values({
          ...d,
          budget: d.budget == null ? null : moneyString(d.budget),
          spent: d.spent == null ? null : moneyString(d.spent),
          tenantId: tenantId(),
          code,
          createdBy: actor(),
          updatedBy: actor(),
        })
        .returning();
      return campDto(row!, undefined);
    });
  }

  updateCamp(id: string, input: crm.UpdateCamp): Promise<crm.Camp> {
    const d = crm.updateCampSchema.parse(input);
    return this.db.tx(async (tx) => {
      const [camp] = await tx.select().from(crmCamps).where(eq(crmCamps.id, id)).limit(1);
      if (!camp) throw notFound('Camp');
      const startsOn = d.startsOn ?? camp.startsOn;
      const endsOn = d.endsOn ?? camp.endsOn;
      if (endsOn < startsOn) throw badRequest('invalid_dates', 'End date is before the start date');
      const { budget, spent, ...rest } = d;
      await tx
        .update(crmCamps)
        .set({
          ...rest,
          ...(budget !== undefined ? { budget: budget == null ? null : moneyString(budget) } : {}),
          ...(spent !== undefined ? { spent: spent == null ? null : moneyString(spent) } : {}),
          updatedBy: actor(),
        })
        .where(eq(crmCamps.id, id));
      return this.campDetail(tx, id);
    });
  }

  private async campDetail(tx: Tx, id: string): Promise<crm.Camp> {
    const [row] = await tx.select().from(crmCamps).where(eq(crmCamps.id, id)).limit(1);
    if (!row) throw notFound('Camp');
    const stats = await this.campStats(tx, [id]);
    return campDto(row, stats.get(id));
  }

  private async campStats(tx: Tx, ids: string[]) {
    const out = new Map<string, { leads: number; converted: number }>();
    if (!ids.length) return out;
    const rows = await tx
      .select({
        id: crmLeads.campId,
        leads: count(),
        converted: sql<number>`count(*) filter (where ${crmLeads.status} = 'converted')::int`,
      })
      .from(crmLeads)
      .where(inArray(crmLeads.campId, ids))
      .groupBy(crmLeads.campId);
    for (const r of rows) out.set(r.id!, { leads: Number(r.leads), converted: Number(r.converted) });
    return out;
  }

  // =====================================================================
  // Campaigns
  // =====================================================================

  listCampaigns(): Promise<crm.Campaign[]> {
    return this.db.tx(async (tx) => {
      const rows = await tx.select().from(crmCampaigns).orderBy(desc(crmCampaigns.createdAt)).limit(200);
      return Promise.all(rows.map((r) => this.campaignDto(tx, r)));
    });
  }

  getCampaign(id: string): Promise<crm.Campaign> {
    return this.db.tx(async (tx) => this.campaignDto(tx, await this.campaignRow(tx, id)));
  }

  createCampaign(input: crm.CampaignInput): Promise<crm.Campaign> {
    const d = crm.campaignInputSchema.parse(input);
    return this.db.tx(async (tx) => {
      await this.checkAudience(tx, d.audience);
      const [row] = await tx
        .insert(crmCampaigns)
        .values({ ...d, tenantId: tenantId(), createdBy: actor(), updatedBy: actor() })
        .returning();
      return this.campaignDto(tx, row!);
    });
  }

  updateCampaign(id: string, input: crm.CampaignInput): Promise<crm.Campaign> {
    const d = crm.campaignInputSchema.parse(input);
    return this.db.tx(async (tx) => {
      const c = await this.campaignRow(tx, id, true);
      if (c.status !== 'draft') throw conflict('campaign_not_draft', 'Only draft campaigns can be edited');
      await this.checkAudience(tx, d.audience);
      const [row] = await tx.update(crmCampaigns).set({ ...d, updatedBy: actor() }).where(eq(crmCampaigns.id, id)).returning();
      return this.campaignDto(tx, row!);
    });
  }

  cancelCampaign(id: string): Promise<crm.Campaign> {
    return this.db.tx(async (tx) => {
      const c = await this.campaignRow(tx, id, true);
      if (c.status !== 'draft') throw conflict('campaign_not_draft', 'Only draft campaigns can be cancelled');
      const [row] = await tx.update(crmCampaigns).set({ status: 'cancelled', updatedBy: actor() }).where(eq(crmCampaigns.id, id)).returning();
      return this.campaignDto(tx, row!);
    });
  }

  /**
   * Send the campaign to every lead in its audience through NotificationsService. Each lead is recorded
   * once (re-sending is a no-op); opted-out or unreachable leads are recorded as skipped.
   */
  sendCampaign(id: string): Promise<crm.Campaign> {
    return this.db.tx(async (tx) => {
      const c = await this.campaignRow(tx, id, true);
      if (c.status !== 'draft') throw conflict('campaign_not_draft', `This campaign is already ${c.status}`);
      const leads = await tx
        .select({ id: crmLeads.id, name: crmLeads.name, mobile: crmLeads.mobile, email: crmLeads.email, patientId: crmLeads.patientId })
        .from(crmLeads)
        .where(audienceWhere(c.audience))
        .orderBy(crmLeads.createdAt)
        .limit(CAMPAIGN_MAX_RECIPIENTS + 1);
      if (!leads.length) throw conflict('campaign_empty', 'No enquiries match this audience');
      if (leads.length > CAMPAIGN_MAX_RECIPIENTS) {
        throw conflict('campaign_too_large', `A campaign can reach at most ${CAMPAIGN_MAX_RECIPIENTS} enquiries; narrow the audience`);
      }
      for (const lead of leads) {
        const reachable = c.channel === 'email' ? !!lead.email : !!lead.mobile;
        const outcome = reachable
          ? await this.messenger.send(tx, {
              to: lead.patientId ? { patientId: lead.patientId } : c.channel === 'email' ? { email: lead.email! } : { mobile: lead.mobile! },
              name: lead.name,
              message: c.message,
              channels: [c.channel as crm.CampaignChannel],
              idempotencyKey: `crm.campaign:${c.id}:${lead.id}`,
              refId: c.id,
            })
          : { queued: 0, skipped: 1, reason: 'no_address' };
        await tx
          .insert(crmCampaignRecipients)
          .values({
            tenantId: c.tenantId,
            campaignId: c.id,
            leadId: lead.id,
            status: outcome.queued > 0 ? 'queued' : 'skipped',
            reason: outcome.queued > 0 ? null : outcome.reason,
          })
          .onConflictDoNothing();
      }
      const [row] = await tx
        .update(crmCampaigns)
        .set({ status: 'sent', sentAt: new Date().toISOString(), sentBy: actor(), recipientCount: leads.length, updatedBy: actor() })
        .where(eq(crmCampaigns.id, id))
        .returning();
      return this.campaignDto(tx, row!);
    });
  }

  private async checkAudience(tx: Tx, a: crm.CampaignAudience) {
    if (a.campId) {
      const [c] = await tx.select({ id: crmCamps.id }).from(crmCamps).where(eq(crmCamps.id, a.campId));
      if (!c) throw notFound('Camp');
    }
  }

  private async campaignRow(tx: Tx, id: string, lock = false): Promise<CampaignRow> {
    const q = tx.select().from(crmCampaigns).where(eq(crmCampaigns.id, id)).limit(1);
    const [row] = lock ? await q.for('update') : await q;
    if (!row) throw notFound('Campaign');
    return row;
  }

  private async campaignDto(tx: Tx, c: CampaignRow): Promise<crm.Campaign> {
    let queued = 0;
    let skipped = 0;
    let audienceSize = c.recipientCount;
    if (c.status === 'sent') {
      const rows = await tx
        .select({ status: crmCampaignRecipients.status, n: count() })
        .from(crmCampaignRecipients)
        .where(eq(crmCampaignRecipients.campaignId, c.id))
        .groupBy(crmCampaignRecipients.status);
      for (const r of rows) {
        if (r.status === 'queued') queued = Number(r.n);
        else skipped += Number(r.n);
      }
    } else if (c.status === 'draft') {
      const [{ n }] = await tx.select({ n: count() }).from(crmLeads).where(audienceWhere(c.audience));
      audienceSize = Number(n);
    }
    return {
      id: c.id,
      name: c.name,
      channel: c.channel as crm.CampaignChannel,
      message: c.message,
      audience: c.audience as crm.CampaignAudience,
      status: c.status as crm.CampaignStatus,
      recipientCount: c.recipientCount,
      queuedCount: queued,
      skippedCount: skipped,
      audienceSize,
      sentAt: c.sentAt ? iso(c.sentAt) : null,
      createdAt: iso(c.createdAt),
    };
  }
}

/** Leads a campaign audience matches. Converted leads are reached as patients; lost leads only if asked for. */
function audienceWhere(a: CrmCampaignAudience) {
  return and(
    a.statuses?.length ? inArray(crmLeads.status, a.statuses) : inArray(crmLeads.status, [...crm.OPEN_LEAD_STATUSES]),
    a.sources?.length ? inArray(crmLeads.source, a.sources) : undefined,
    a.campId ? eq(crmLeads.campId, a.campId) : undefined,
  );
}

function campDto(r: CampRow, s: { leads: number; converted: number } | undefined): crm.Camp {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type as crm.CampType,
    facilityId: r.facilityId,
    location: r.location,
    startsOn: r.startsOn,
    endsOn: r.endsOn,
    status: r.status as crm.CampStatus,
    targetCount: r.targetCount,
    budget: toNumberOrNull(r.budget),
    spent: toNumberOrNull(r.spent),
    notes: r.notes,
    leadCount: s?.leads ?? 0,
    convertedCount: s?.converted ?? 0,
    createdAt: iso(r.createdAt),
  };
}
