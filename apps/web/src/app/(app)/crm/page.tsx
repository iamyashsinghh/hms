'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LEAD_SOURCE_LABELS, StatTile, formatINR } from '@/modules/crm/ui';

export default function CrmOverviewPage() {
  const canRead = usePermission('crm.lead.read');
  const { data, error } = useQuery({ queryKey: ['crm', 'dashboard'], queryFn: () => api.crm.dashboard(), enabled: canRead });

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader title="CRM overview" description="Enquiries, follow-ups, referrals and camps at a glance." />
      {error && <p className="mb-4 text-sm text-destructive">{errorMessage(error)}</p>}
      {data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Link href="/crm/leads?status=open">
              <StatTile label="Open enquiries" value={data.leads.open} hint={`${data.leads.newToday} new today`} />
            </Link>
            <Link href="/crm/leads?due=true">
              <StatTile label="Enquiry calls due" value={data.leads.dueFollowUps} tone={data.leads.dueFollowUps ? 'warn' : undefined} />
            </Link>
            <StatTile label="Converted this month" value={data.leads.convertedThisMonth} hint={`${data.leads.lostThisMonth} lost`} />
            <Link href="/crm/follow-ups?when=overdue">
              <StatTile
                label="Patient follow-ups"
                value={data.followUps.today}
                hint={`${data.followUps.overdue} overdue · ${data.followUps.upcoming7d} next 7 days`}
                tone={data.followUps.overdue ? 'warn' : undefined}
              />
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Referrals this month" value={data.referrals.thisMonth} />
            <StatTile label="Commission accrued" value={formatINR(data.commission.open)} hint="Not yet on a statement" />
            <StatTile label="Commission payable" value={formatINR(data.commission.payable)} hint={`${formatINR(data.commission.paidThisMonth)} paid this month`} />
            <StatTile label="Camps" value={data.camps.upcoming} hint={`${data.camps.ongoing} running now`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Enquiries by source (90 days)</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Enquiries</TableHead>
                      <TableHead className="text-right">Converted</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.bySource.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                          No enquiries yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.bySource.map((s) => (
                        <TableRow key={s.source}>
                          <TableCell>{LEAD_SOURCE_LABELS[s.source]}</TableCell>
                          <TableCell className="text-right tabular-nums">{s.total}</TableCell>
                          <TableCell className="text-right tabular-nums">{s.converted}</TableCell>
                          <TableCell className="text-right tabular-nums">{s.total ? Math.round((s.converted / s.total) * 100) : 0}%</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Top referrers this month</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Referrer</TableHead>
                      <TableHead className="text-right">Referrals</TableHead>
                      <TableHead className="text-right">Commission</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.referrals.topReferrers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                          No referrals this month.
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.referrals.topReferrers.map((r) => (
                        <TableRow key={r.referrerId}>
                          <TableCell>
                            <Link href={`/crm/referrers/${r.referrerId}`} className="font-medium text-primary hover:underline">
                              {r.name}
                            </Link>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{r.referrals}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatINR(r.commission)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
