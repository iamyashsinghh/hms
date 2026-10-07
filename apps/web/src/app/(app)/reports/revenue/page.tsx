'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, ErrorNote, modeLabel, money, moneyExact, num, plural, RangeFilters, RankList, shortDate, SimpleTable, StatTile, useRange } from '@/modules/reports/ui';

export default function RevenueReportPage() {
  const allowed = usePermission('reports.revenue.read');
  const [range, setRange] = useRange(30);
  const { data, error, isFetching } = useQuery({
    queryKey: ['reports', 'revenue', range],
    queryFn: () => api.reports.revenue(range),
    placeholderData: keepPreviousData,
    enabled: allowed,
  });
  if (!allowed) return <NoAccess />;

  return (
    <>
      <PageHeader title="Revenue report" description="Billed and collected amounts by day, doctor, service and payment mode." />
      <RangeFilters
        value={range}
        onChange={setRange}
        busy={isFetching}
        exports={[
          { report: 'revenue-by-doctor', label: 'By doctor CSV' },
          { report: 'revenue-by-service', label: 'By service CSV' },
        ]}
      />
      {error ? (
        <ErrorNote error={error} />
      ) : data ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile label="Billed" value={data.billed} format={money} hint="Invoices finalized in this period" />
            <StatTile label="Collected" value={data.collected} format={money} hint="Payments received in this period" />
            <StatTile label="Outstanding" value={data.outstanding} format={money} hint={`All unpaid balances as of ${shortDate(data.to)}`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <BarChart title="Billed per day" format={money} data={data.byDay.map((d) => ({ label: shortDate(d.date), value: d.billed }))} />
            <BarChart title="Collected per day" format={money} data={data.byDay.map((d) => ({ label: shortDate(d.date), value: d.collected }))} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Revenue by doctor</CardTitle>
              </CardHeader>
              <SimpleTable
                head={['Doctor', 'Visits', 'Revenue']}
                align={['left', 'right', 'right']}
                empty="No doctor revenue in this period."
                rows={data.byDoctor.map((d) => [d.name, num(d.visits), moneyExact(d.revenue)])}
              />
            </Card>
            <RankList
              title="Collections by payment mode"
              format={money}
              rows={data.byMode.map((m) => ({ key: m.mode, label: modeLabel(m.mode), value: m.amount, sub: plural(m.count, 'payment') }))}
            />
          </div>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Revenue by service</CardTitle>
            </CardHeader>
            <SimpleTable
              head={['Code', 'Service', 'Qty', 'Amount']}
              align={['left', 'left', 'right', 'right']}
              empty="No billed services in this period."
              rows={data.byService.map((s) => [s.code ?? '—', s.description, num(s.qty), moneyExact(s.amount)])}
            />
          </Card>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </>
  );
}
