'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { BarChart, ErrorNote, num, RangeFilters, RankList, shortDate, StatTile, useRange } from '@/modules/reports/ui';

const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;

export default function OpdReportPage() {
  const allowed = usePermission('reports.opd.read');
  const [range, setRange] = useRange(7);
  const { data, error, isFetching } = useQuery({
    queryKey: ['reports', 'opd', range],
    queryFn: () => api.reports.opd(range),
    placeholderData: keepPreviousData,
    enabled: allowed,
  });
  if (!allowed) return <NoAccess />;

  return (
    <>
      <PageHeader title="OPD report" description="Checked-in OPD visits by doctor, day and hour." />
      <RangeFilters value={range} onChange={setRange} busy={isFetching} exports={[{ report: 'opd-visits', label: 'Visit list CSV' }]} />
      {error ? (
        <ErrorNote error={error} />
      ) : data ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile label="Total visits" value={data.total} />
            <StatTile label="First visits" value={data.newVisits} hint="Patient's first OPD visit" />
            <StatTile label="Follow-up visits" value={data.followUpVisits} hint="Patient visited before" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <BarChart title="Visits per day" data={data.byDay.map((d) => ({ label: shortDate(d.date), value: d.visits }))} />
            <BarChart
              title="Visits by check-in hour"
              data={Array.from({ length: 24 }, (_, h) => ({ label: hourLabel(h), value: data.byHour.find((x) => x.hour === h)?.visits ?? 0 }))}
            />
          </div>
          <RankList
            title="Visits by doctor"
            format={num}
            rows={data.byDoctor.map((d) => ({ key: d.doctorId ?? 'none', label: d.name, value: d.visits }))}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </>
  );
}
