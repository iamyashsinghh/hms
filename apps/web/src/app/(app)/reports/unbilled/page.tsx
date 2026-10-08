'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { reports as R } from '@hms/shared';
import { api } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { DateFilter, ErrorNote, ExportButton, localToday, moneyExact, plural, shortDate, SimpleTable, StatTile } from '@/modules/reports/ui';

const age = (days: number) => (days <= 0 ? 'Today' : `${plural(days, 'day')}`);

export default function UnbilledChargesPage() {
  const allowed = usePermission('reports.collection.read');
  const canBill = usePermission('billing.invoice.create');
  const [f, setF] = React.useState<{ date: string; facilityId?: string }>(() => ({ date: localToday() }));
  const { data, error, isFetching } = useQuery({
    queryKey: ['reports', 'unbilled', f],
    queryFn: () => api.reports.unbilled(f),
    placeholderData: keepPreviousData,
    enabled: allowed,
  });
  if (!allowed) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Unbilled charges"
        description="Day-end check: charges departments posted to patients' accounts that were not billed by the end of the day."
      />
      <DateFilter
        date={f.date}
        facilityId={f.facilityId}
        onChange={setF}
        busy={isFetching}
        actions={<ExportButton query={{ report: 'unbilled-charges', from: f.date, to: f.date, facilityId: f.facilityId }} />}
      />
      {error ? (
        <ErrorNote error={error} />
      ) : data ? (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatTile
              label="Unbilled"
              value={data.total.amount}
              format={moneyExact}
              hint={`${plural(data.total.count, 'charge')} · ${plural(data.total.patients, 'patient')}`}
            />
            {data.byAge.map((a) => (
              <StatTile key={a.key} label={a.key === 'today' ? 'Posted today' : a.label} value={a.amount} format={moneyExact} hint={plural(a.count, 'charge')} />
            ))}
          </div>

          <Card className="mb-6">
            <CardHeader className="pb-2">
              <CardTitle>By department</CardTitle>
            </CardHeader>
            <SimpleTable
              head={['Department', 'Charges', 'Patients', 'Oldest', 'Amount']}
              align={['left', 'right', 'right', 'left', 'right']}
              empty="Nothing unbilled. Every charge was billed."
              rows={data.byModule.map((m) => [m.label, m.count, m.patients, shortDate(m.oldestDate), moneyExact(m.amount)])}
            />
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>By patient (oldest first)</CardTitle>
            </CardHeader>
            <SimpleTable
              head={['Patient', 'UHID', 'Departments', 'Oldest charge', 'Charges', 'Amount']}
              align={['left', 'left', 'left', 'left', 'right', 'right']}
              empty="No patient has unbilled charges."
              rows={data.byPatient.map((p) => [
                canBill ? (
                  <Link key="n" href={`/billing/new?patientId=${p.patientId}`} className="font-medium text-primary hover:underline">
                    {p.patientName ?? '—'}
                  </Link>
                ) : (
                  (p.patientName ?? '—')
                ),
                <span key="u" className="font-mono text-xs">
                  {p.uhid ?? '—'}
                </span>,
                <span key="m" className="flex flex-wrap gap-1">
                  {p.modules.map((m) => (
                    <Badge key={m} variant="outline">
                      {R.chargeSourceLabel(m)}
                    </Badge>
                  ))}
                  {p.accounts.includes('ipd') && <Badge variant="secondary">IPD</Badge>}
                </span>,
                <span key="o" className={p.ageDays >= 3 ? 'text-destructive' : undefined}>
                  {shortDate(p.oldestDate)} · {age(p.ageDays)}
                </span>,
                p.count,
                moneyExact(p.amount),
              ])}
            />
          </Card>
          <p className="mt-3 text-xs text-muted-foreground">Amounts include GST and line discounts. Dates are in the hospital&apos;s time zone ({data.timezone}).</p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </>
  );
}
