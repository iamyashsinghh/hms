'use client';

import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import {
  BarChart,
  DateFilter,
  EmptyHint,
  ErrorNote,
  localToday,
  modeLabel,
  money,
  num,
  plural,
  RangeFilters,
  RankList,
  shortDate,
  StatTile,
  useRange,
} from '@/modules/reports/ui';

export default function ReportsDashboardPage() {
  const allowed = usePermission('reports.dashboard.read');
  const [day, setDay] = React.useState<{ date: string; facilityId?: string }>(() => ({ date: localToday() }));
  const [range, setRange] = useRange(30);

  const summary = useQuery({
    queryKey: ['reports', 'owner-summary', day],
    queryFn: () => api.reports.ownerSummary(day),
    placeholderData: keepPreviousData,
    enabled: allowed,
  });
  const dash = useQuery({
    queryKey: ['reports', 'dashboard', range],
    queryFn: () => api.reports.dashboard(range),
    placeholderData: keepPreviousData,
    enabled: allowed,
  });

  if (!allowed) return <NoAccess />;
  const s = summary.data;
  const d = dash.data;

  return (
    <>
      <PageHeader title="MIS dashboard" description="How the hospital is doing: patients, visits, billing and collections." />

      <DateFilter date={day.date} facilityId={day.facilityId} onChange={setDay} busy={summary.isFetching} />
      {summary.error ? (
        <ErrorNote error={summary.error} />
      ) : s ? (
        <>
          {s.opdVisits + s.billed + s.collections === 0 && <EmptyHint />}
          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatTile label="OPD visits" value={s.opdVisits} previous={s.previous.opdVisits} />
            <StatTile label="New patients" value={s.newPatients} previous={s.previous.newPatients} />
            <StatTile label="Billed" value={s.billed} previous={s.previous.billed} format={money} />
            <StatTile
              label="Not yet billed"
              value={s.unbilledCharges.amount}
              format={money}
              hint={`${plural(s.unbilledCharges.count, 'charge')} · ${plural(s.unbilledCharges.patients, 'patient')} at day end`}
            />
            <StatTile label="Collections" value={s.collections} previous={s.previous.collections} format={money} />
            <StatTile label="Pending bills" value={s.pendingBills.amount} format={money} hint={`${plural(s.pendingBills.count, 'bill')} with a balance`} />
            <StatTile label="Appointments" value={s.appointmentsBooked} hint={`${num(s.appointmentsCancelled)} cancelled`} />
            <StatTile label="Consultations signed" value={s.consultationsSigned} hint="Doctor notes completed" />
            <StatTile label="Pharmacy dispenses" value={s.pharmacyDispenses} hint="Prescriptions filled" />
          </div>
        </>
      ) : (
        <p className="mb-8 text-sm text-muted-foreground">Loading…</p>
      )}

      <h2 className="mb-3 text-lg font-semibold">Trend</h2>
      <RangeFilters
        value={range}
        onChange={setRange}
        busy={dash.isFetching}
        exports={[{ report: 'daily-summary', label: 'Daily summary CSV' }]}
      />
      {dash.error ? (
        <ErrorNote error={dash.error} />
      ) : d ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <BarChart title="OPD visits per day" data={d.daily.map((p) => ({ label: shortDate(p.date), value: p.opdVisits }))} />
            <BarChart title="Collections per day" format={money} data={d.daily.map((p) => ({ label: shortDate(p.date), value: p.collections }))} />
            <BarChart title="New patients per day" data={d.daily.map((p) => ({ label: shortDate(p.date), value: p.newPatients }))} />
            <BarChart title="Billed per day" format={money} data={d.daily.map((p) => ({ label: shortDate(p.date), value: p.billed }))} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <RankList
              title="Top doctors by revenue"
              format={money}
              rows={d.topDoctors.map((x) => ({ key: x.doctorId, label: x.name, value: x.revenue, sub: plural(x.visits, 'visit') }))}
            />
            <RankList
              title="Top services"
              format={money}
              rows={d.topServices.map((x, i) => ({ key: `${x.code ?? x.description}-${i}`, label: x.description, value: x.amount, sub: x.code ?? undefined }))}
            />
            <RankList
              title="Collections by payment mode"
              format={money}
              rows={d.collectionsByMode.map((x) => ({ key: x.mode, label: modeLabel(x.mode), value: x.amount, sub: plural(x.count, 'payment') }))}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Outstanding across all bills: {money(d.totals.pendingAmount)}. Dates are in the hospital&apos;s time zone ({d.timezone}).
          </p>
        </div>
      ) : null}
    </>
  );
}
