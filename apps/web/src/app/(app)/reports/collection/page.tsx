'use client';

import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { DateFilter, ErrorNote, ExportButton, localToday, modeLabel, moneyExact, plural, SimpleTable, StatTile } from '@/modules/reports/ui';

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

export default function DailyCollectionPage() {
  const allowed = usePermission('reports.collection.read');
  const [f, setF] = React.useState<{ date: string; facilityId?: string }>(() => ({ date: localToday() }));
  const { data, error, isFetching } = useQuery({
    queryKey: ['reports', 'daily-collection', f],
    queryFn: () => api.reports.dailyCollection(f),
    placeholderData: keepPreviousData,
    enabled: allowed,
  });
  if (!allowed) return <NoAccess />;

  return (
    <>
      <PageHeader title="Daily collection" description="Every payment received on a day, with totals by payment mode." />
      <DateFilter
        date={f.date}
        facilityId={f.facilityId}
        onChange={setF}
        busy={isFetching}
        actions={<ExportButton query={{ report: 'collections', from: f.date, to: f.date, facilityId: f.facilityId }} />}
      />
      {error ? (
        <ErrorNote error={error} />
      ) : data ? (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Total collected" value={data.total} format={moneyExact} hint={plural(data.rows.length, 'payment')} />
            {data.byMode.map((m) => (
              <StatTile key={m.mode} label={modeLabel(m.mode)} value={m.amount} format={moneyExact} hint={plural(m.count, 'payment')} />
            ))}
          </div>
          <Card>
            <SimpleTable
              head={['Time', 'Invoice', 'UHID', 'Patient', 'Mode', 'Amount']}
              align={['left', 'left', 'left', 'left', 'left', 'right']}
              empty="No payments on this day."
              rows={data.rows.map((r) => [
                time(r.receivedAt),
                r.invoiceNumber ?? '—',
                <span key="u" className="font-mono text-xs">{r.uhid ?? '—'}</span>,
                r.patientName ?? '—',
                modeLabel(r.mode),
                moneyExact(r.amount),
              ])}
            />
          </Card>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </>
  );
}
