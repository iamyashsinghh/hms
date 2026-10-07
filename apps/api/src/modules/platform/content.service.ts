import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  iso,
  platformAnnouncementDismissals,
  platformAnnouncements,
  platformHelpArticles,
  platformOnboardingSteps,
  sql,
  type Tx,
} from '@hms/db';
import { ONBOARDING_STEPS, type Announcement, type HelpArticle, type OnboardingChecklist, type OnboardingStepKey } from './contracts';
import { currentContext } from '../../common/context/request-context';
import { badRequest, notFound } from '../../common/errors/errors';
import { PlatformDb } from './platform-db';
import { toAnnouncement, toHelpArticle } from './mappers';

/** Announcements, help articles and the onboarding checklist as hospital staff see them. */
@Injectable()
export class ContentService {
  constructor(private readonly db: PlatformDb) {}

  /** Live announcements for this hospital's plan that the user has not dismissed. */
  announcements(): Promise<Announcement[]> {
    const ctx = currentContext()!;
    return this.db.tenant(ctx.tenantId!, async (tx) => {
      const a = platformAnnouncements;
      const rows = await tx
        .select()
        .from(a)
        .where(sql`${a.isPublished} and ${a.startsAt} <= now() and (${a.endsAt} is null or ${a.endsAt} > now())
          and exists (select 1 from platform.tenants t where t.id = ${ctx.tenantId}::uuid
                        and (cardinality(${a.planCodes}) = 0 or t.plan = any(${a.planCodes}))
                        and (cardinality(${a.tenantIds}) = 0 or t.id = any(${a.tenantIds})))
          and not exists (select 1 from platform.announcement_dismissals d
                           where d.tenant_id = ${ctx.tenantId}::uuid and d.announcement_id = ${a.id} and d.user_id = ${ctx.userId}::uuid)`)
        .orderBy(sql`case ${a.severity} when 'critical' then 0 when 'warning' then 1 else 2 end`, desc(a.startsAt))
        .limit(20);
      return rows.map(toAnnouncement);
    });
  }

  async dismiss(announcementId: string): Promise<void> {
    const ctx = currentContext()!;
    await this.db.tenant(ctx.tenantId!, async (tx) => {
      const exists = await tx.execute(sql`select 1 from platform.announcements where id = ${announcementId}::uuid`);
      if (!exists.rows.length) throw notFound('Announcement');
      await tx
        .insert(platformAnnouncementDismissals)
        .values({ tenantId: ctx.tenantId!, announcementId, userId: ctx.userId! })
        .onConflictDoNothing();
    });
  }

  async help(q?: string, moduleKey?: string): Promise<HelpArticle[]> {
    const term = q?.toLowerCase();
    const rows = await this.db.global
      .select()
      .from(platformHelpArticles)
      .where(
        and(
          eq(platformHelpArticles.isPublished, true),
          moduleKey ? eq(platformHelpArticles.moduleKey, moduleKey) : undefined,
          term
            ? sql`(lower(${platformHelpArticles.title}) like ${'%' + term + '%'} or lower(${platformHelpArticles.body}) like ${'%' + term + '%'})`
            : undefined,
        ),
      )
      .orderBy(asc(platformHelpArticles.sortOrder), asc(platformHelpArticles.title));
    return rows.map(toHelpArticle);
  }

  async helpArticle(slug: string): Promise<HelpArticle> {
    const [row] = await this.db.global
      .select()
      .from(platformHelpArticles)
      .where(and(eq(platformHelpArticles.slug, slug), eq(platformHelpArticles.isPublished, true)))
      .limit(1);
    if (!row) throw notFound('Help article');
    return toHelpArticle(row);
  }

  onboarding(): Promise<OnboardingChecklist> {
    const tenantId = currentContext()!.tenantId!;
    return this.db.tenant(tenantId, (tx) => this.onboardingIn(tx, tenantId));
  }

  /** Inside the hospital's transaction. Auto steps come from data (core tables and the subscription). */
  async onboardingIn(tx: Tx, tenantId: string): Promise<OnboardingChecklist> {
    const done = await tx.select().from(platformOnboardingSteps).where(eq(platformOnboardingSteps.tenantId, tenantId));
    const manual = new Map(done.map((d) => [d.stepKey, d.completedAt]));
    const facts = await tx.execute<{ users: number; patients: boolean; paid: boolean }>(sql`
      select (select count(*)::int from iam.users where status <> 'disabled') as users,
             exists (select 1 from clinical.patients) as patients,
             exists (select 1 from platform.invoices where status = 'paid') as paid`);
    const f = facts.rows[0]!;
    const auto: Partial<Record<OnboardingStepKey, boolean>> = {
      add_staff: f.users > 1,
      first_patient: f.patients,
      choose_plan: f.paid,
    };
    const steps = ONBOARDING_STEPS.map((s) => {
      const isDone = s.auto ? !!auto[s.key] : manual.has(s.key);
      return {
        key: s.key,
        title: s.title,
        description: s.description,
        href: s.href,
        auto: s.auto,
        done: isDone,
        completedAt: s.auto ? null : iso(manual.get(s.key) ?? null),
      };
    });
    return { steps, done: steps.filter((s) => s.done).length, total: steps.length };
  }

  setStep(key: OnboardingStepKey, completed: boolean): Promise<OnboardingChecklist> {
    const ctx = currentContext()!;
    const step = ONBOARDING_STEPS.find((s) => s.key === key);
    if (!step) throw notFound('Step');
    if (step.auto) throw badRequest('auto_step', 'This step is ticked automatically');
    return this.db.tenant(ctx.tenantId!, async (tx) => {
      if (completed) {
        await tx
          .insert(platformOnboardingSteps)
          .values({ tenantId: ctx.tenantId!, stepKey: key, completedBy: ctx.userId })
          .onConflictDoNothing();
      } else {
        await tx
          .delete(platformOnboardingSteps)
          .where(and(eq(platformOnboardingSteps.tenantId, ctx.tenantId!), eq(platformOnboardingSteps.stepKey, key)));
      }
      return this.onboardingIn(tx, ctx.tenantId!);
    });
  }
}
