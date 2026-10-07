import { Injectable } from '@nestjs/common';
import { sql } from '@hms/db';
import type { crm } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { addDays, monthStart, todayIST, toNumber } from './crm.util';

/** One-screen CRM summary: enquiry funnel, follow-ups due, referrals and commission owed, camps. */
@Injectable()
export class CrmDashboardService {
  constructor(private readonly db: DbService) {}

  get(): Promise<crm.CrmDashboard> {
    const today = todayIST();
    const month = monthStart(today);
    const week = addDays(today, 7);
    return this.db.tx(async (tx) => {
      const one = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) => (await tx.execute<T>(q)).rows;
      const [[leads], bySource, [follow], [refs], top, [comm], [camps]] = await Promise.all([
        one<{ open: string; new_today: string; due: string; converted: string; lost: string }>(sql`
          select count(*) filter (where status in ('new','contacted','qualified')) as open,
                 count(*) filter (where (created_at at time zone 'Asia/Kolkata')::date = ${today}::date) as new_today,
                 count(*) filter (where status in ('new','contacted','qualified') and next_follow_up_at <= now()) as due,
                 count(*) filter (where status = 'converted' and (converted_at at time zone 'Asia/Kolkata')::date >= ${month}::date) as converted,
                 count(*) filter (where status = 'lost' and (updated_at at time zone 'Asia/Kolkata')::date >= ${month}::date) as lost
            from crm.leads`),
        one<{ source: string; total: string; converted: string }>(sql`
          select source, count(*) as total, count(*) filter (where status = 'converted') as converted
            from crm.leads where created_at >= now() - interval '90 days'
           group by source order by count(*) desc`),
        one<{ overdue: string; today: string; upcoming: string }>(sql`
          select count(*) filter (where due_date < ${today}::date) as overdue,
                 count(*) filter (where due_date = ${today}::date) as today,
                 count(*) filter (where due_date > ${today}::date and due_date <= ${week}::date) as upcoming
            from crm.follow_ups where status = 'pending'`),
        one<{ n: string }>(sql`select count(*) as n from crm.referrals where referred_on >= ${month}::date`),
        one<{ id: string; name: string; referrals: string; commission: string }>(sql`
          select r.id, r.name,
                 (select count(*) from crm.referrals x where x.tenant_id = r.tenant_id and x.referrer_id = r.id and x.referred_on >= ${month}::date) as referrals,
                 (select coalesce(sum(c.amount), 0) from crm.commissions c where c.tenant_id = r.tenant_id and c.referrer_id = r.id
                     and c.status = 'open' and c.invoice_date >= ${month}::date) as commission
            from crm.referrers r
           order by 3 desc, 4 desc limit 5`),
        one<{ open: string; payable: string; paid: string }>(sql`
          select (select coalesce(sum(amount), 0) from crm.commissions where status = 'open' and statement_id is null) as open,
                 (select coalesce(sum(total), 0) from crm.commission_statements where status = 'approved') as payable,
                 (select coalesce(sum(total), 0) from crm.commission_statements where status = 'paid'
                     and (paid_at at time zone 'Asia/Kolkata')::date >= ${month}::date) as paid`),
        one<{ upcoming: string; ongoing: string }>(sql`
          select count(*) filter (where status = 'planned' and starts_on >= ${today}::date) as upcoming,
                 count(*) filter (where status = 'ongoing' or (status = 'planned' and ${today}::date between starts_on and ends_on)) as ongoing
            from crm.camps`),
      ]);
      return {
        leads: {
          open: Number(leads!.open),
          newToday: Number(leads!.new_today),
          dueFollowUps: Number(leads!.due),
          convertedThisMonth: Number(leads!.converted),
          lostThisMonth: Number(leads!.lost),
        },
        bySource: bySource.map((s) => ({ source: s.source as crm.LeadSource, total: Number(s.total), converted: Number(s.converted) })),
        followUps: { overdue: Number(follow!.overdue), today: Number(follow!.today), upcoming7d: Number(follow!.upcoming) },
        referrals: {
          thisMonth: Number(refs!.n),
          topReferrers: top
            .filter((t) => Number(t.referrals) > 0 || toNumber(t.commission) > 0)
            .map((t) => ({ referrerId: t.id, name: t.name, referrals: Number(t.referrals), commission: toNumber(t.commission) })),
        },
        commission: { open: toNumber(comm!.open), payable: toNumber(comm!.payable), paidThisMonth: toNumber(comm!.paid) },
        camps: { upcoming: Number(camps!.upcoming), ongoing: Number(camps!.ongoing) },
      };
    });
  }
}
