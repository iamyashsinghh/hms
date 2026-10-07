'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { FilePlus2 } from 'lucide-react';
import { quality as Q } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CATEGORY_LABELS, IndicatorStatus, KpiTile, currentPeriod, formatIndicator, formatTarget, periodLabel } from '@/modules/quality/ui';

const lowerIsBetter = new Map(Q.INDICATORS.map((d) => [d.code, d.lowerIsBetter]));

export default function QualityDashboardPage() {
  const canRead = usePermission('quality.indicator.read');
  const canReport = usePermission('quality.incident.report');
  const [period, setPeriod] = React.useState(currentPeriod());
  const { data, isPending, error } = useQuery({ queryKey: ['quality', 'dashboard', period], queryFn: () => api.quality.dashboard(period), enabled: canRead });

  if (!canRead) {
    if (!canReport) return <NoAccess />;
    return (
      <Card className="mx-auto mt-8 max-w-md text-center">
        <CardHeader>
          <CardTitle>Patient safety starts with reporting</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Report any incident or near miss. You can report anonymously.</p>
          <Link href="/quality/incidents/new" className={buttonVariants()}>
            <FilePlus2 /> Report an incident
          </Link>
        </CardContent>
      </Card>
    );
  }

  const max = Math.max(1, ...(data?.incidentsByCategory.map((c) => c.count) ?? [1]));
  const computed = data?.indicators.filter((i) => i.source === 'computed') ?? [];

  return (
    <>
      <PageHeader
        title="Quality & NABH"
        description={`Patient safety and quality indicators for ${periodLabel(period)}.`}
        actions={
          <>
            <Input type="month" aria-label="Month" className="w-40" value={period} max={currentPeriod()} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
            <Can permission="quality.incident.report">
              <Link href="/quality/incidents/new" className={buttonVariants()}>
                <FilePlus2 /> Report incident
              </Link>
            </Can>
          </>
        }
      />
      {error && <p className="text-sm text-destructive">{errorMessage(error)}</p>}
      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <KpiTile label="Open incidents" value={data.openIncidents} href="/quality/incidents" />
            <KpiTile label="Incidents this month" value={data.incidentsThisMonth} />
            <KpiTile label="Sentinel events" value={data.sentinelThisMonth} tone={data.sentinelThisMonth ? 'bad' : undefined} />
            <KpiTile label="Open complaints" value={data.openComplaints} href="/quality/complaints" />
            <KpiTile label="Complaints overdue" value={data.overdueComplaints} tone={data.overdueComplaints ? 'bad' : undefined} href="/quality/complaints?overdue=true" />
            <KpiTile label="Open CAPAs" value={data.openCapas} href="/quality/capa" />
            <KpiTile label="CAPAs overdue" value={data.overdueCapas} tone={data.overdueCapas ? 'bad' : undefined} href="/quality/capa?overdue=true" />
            <KpiTile label="Audits due" value={data.auditsDue} href="/quality/audits" />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Key indicators</CardTitle>
                <Link href="/quality/indicators" className="text-sm text-primary hover:underline">
                  All indicators
                </Link>
              </CardHeader>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Indicator</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Target</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {computed.map((i) => (
                    <TableRow key={i.code}>
                      <TableCell>
                        <div className="font-medium">{i.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {i.numerator ?? 0}
                          {i.denominatorLabel ? ` / ${i.denominator ?? 0} ${i.denominatorLabel.toLowerCase()}` : ''}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatIndicator(i)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{formatTarget(i, lowerIsBetter.get(i.code) ?? true)}</TableCell>
                      <TableCell>
                        <IndicatorStatus status={i.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Incidents by category</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.incidentsByCategory.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No incidents reported this month.</p>
                  ) : (
                    <ul className="space-y-2">
                      {data.incidentsByCategory.map((c) => (
                        <li key={c.category} className="text-sm">
                          <div className="flex justify-between">
                            <span>{CATEGORY_LABELS[c.category]}</span>
                            <span className="tabular-nums">{c.count}</span>
                          </div>
                          <div className="mt-1 h-1.5 rounded-full bg-muted">
                            <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(c.count / max) * 100}%` }} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
              <KpiTile label="NABH documents due for review (30 days)" value={data.documentsDueForReview} href="/quality/documents?reviewDue=true" />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
