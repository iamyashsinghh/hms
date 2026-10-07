'use client';

import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, formatINR, todayIST } from '@/modules/billing/ui';

export default function ShiftsPage() {
  const canRead = usePermission('billing.shift.read');
  const [date, setDate] = React.useState(todayIST());
  const { data, isPending, error } = useQuery({
    queryKey: ['billing', 'shifts', date],
    queryFn: () => api.billing.shifts.list({ from: date || undefined, to: date || undefined, pageSize: 100 }),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });

  if (!canRead) return <NoAccess />;

  const totals = (data?.items ?? []).reduce<Record<string, number>>((acc, s) => {
    for (const [k, v] of Object.entries(s.totals)) acc[k] = (acc[k] ?? 0) + v;
    return acc;
  }, {});

  return (
    <>
      <PageHeader title="Cash shifts" description="Every cashier's shifts with collections by mode and cash differences." />
      <Card>
        <div className="flex flex-wrap items-center gap-4 border-b p-4 text-sm">
          <Input type="date" className="w-44" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
          {Object.entries(totals).map(([mode, v]) => (
            <span key={mode}>
              <span className="uppercase text-muted-foreground">{mode}</span> <span className="font-semibold tabular-nums">{formatINR(v)}</span>
            </span>
          ))}
        </div>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Cashier</TableHead>
                <TableHead>Opened</TableHead>
                <TableHead>Closed</TableHead>
                <TableHead className="text-right">Cash</TableHead>
                <TableHead className="text-right">UPI</TableHead>
                <TableHead className="text-right">Card</TableHead>
                <TableHead className="text-right">Expected</TableHead>
                <TableHead className="text-right">Counted</TableHead>
                <TableHead className="text-right">Diff.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                    No shifts on this day.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.userName ?? '—'}</TableCell>
                    <TableCell>{formatDateTime(s.openedAt)}</TableCell>
                    <TableCell>{s.status === 'open' ? <Badge>Open</Badge> : formatDateTime(s.closedAt)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(s.totals.cash ?? 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(s.totals.upi ?? 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(s.totals.card ?? 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(s.expectedCash)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(s.countedCash)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${s.difference && s.difference < 0 ? 'text-destructive' : ''}`}>{formatINR(s.difference)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
