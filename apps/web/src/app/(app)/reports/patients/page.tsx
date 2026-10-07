'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { genderLabel } from '@/lib/format';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { BarChart, ErrorNote, RangeFilters, RankList, shortDate, StatTile, useRange } from '@/modules/reports/ui';

export default function PatientsReportPage() {
  const allowed = usePermission('reports.patient.read');
  const [range, setRange] = useRange(30);
  const { data, error, isFetching } = useQuery({
    queryKey: ['reports', 'patients', range],
    queryFn: () => api.reports.patients(range),
    placeholderData: keepPreviousData,
    enabled: allowed,
  });
  if (!allowed) return <NoAccess />;

  return (
    <>
      <PageHeader title="Patient report" description="New patient registrations by day, gender and age group." />
      <RangeFilters value={range} onChange={setRange} busy={isFetching} exports={[{ report: 'new-patients', label: 'Patient list CSV' }]} />
      {error ? (
        <ErrorNote error={error} />
      ) : data ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile label="New patients" value={data.newPatients} />
          </div>
          <BarChart title="Registrations per day" data={data.byDay.map((d) => ({ label: shortDate(d.date), value: d.count }))} />
          <div className="grid gap-4 lg:grid-cols-2">
            <RankList title="By gender" rows={data.byGender.map((g) => ({ key: g.gender, label: genderLabel(g.gender), value: g.count }))} />
            <RankList title="By age group" rows={data.byAgeBand.map((a) => ({ key: a.band, label: a.band, value: a.count }))} />
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </>
  );
}
