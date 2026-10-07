'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { billing as B } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ErrorBox, Field, formatINR } from '@/modules/billing/ui';
import { ShiftSummary } from '@/modules/billing/shift-summary';

export default function MyShiftPage() {
  const canManage = usePermission('billing.shift.manage');
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({ queryKey: ['billing', 'shift', 'current'], queryFn: () => api.billing.shifts.current(), enabled: canManage, refetchInterval: 30_000 });
  const [opening, setOpening] = React.useState('0');
  const [counted, setCounted] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [closed, setClosed] = React.useState<B.CashShift | null>(null);

  const open = useMutation({
    mutationFn: () => api.billing.shifts.open({ openingCash: Number(opening) || 0 }),
    onSuccess: (shift) => {
      setClosed(null);
      queryClient.setQueryData(['billing', 'shift', 'current'], { shift });
    },
  });
  const close = useMutation({
    mutationFn: () => api.billing.shifts.close({ countedCash: Number(counted), notes: notes.trim() || undefined }),
    onSuccess: (shift) => {
      setClosed(shift);
      setCounted('');
      setNotes('');
      queryClient.setQueryData(['billing', 'shift', 'current'], { shift: null });
    },
  });

  if (!canManage) return <NoAccess />;
  const shift = data?.shift;

  return (
    <div className="max-w-3xl">
      <PageHeader title="My cash shift" description="Open a shift at the start of the counter, and close it by counting the cash in the drawer. Collections are tracked automatically." />
      {error && <ErrorBox error={errorMessage(error)} />}
      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : shift ? (
        <div className="space-y-6">
          <ShiftSummary shift={shift} />
          <Card>
            <CardHeader>
              <CardTitle>Close shift</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <ErrorBox error={close.error ? errorMessage(close.error) : null} />
              </div>
              <Field id="counted" label="Cash counted in drawer (₹) *">
                <Input id="counted" type="number" min={0} step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} />
              </Field>
              <Field id="notes" label="Notes">
                <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              {counted !== '' && (
                <p className="text-sm sm:col-span-2">
                  Difference: <span className="font-semibold">{formatINR(Number(counted) - shift.expectedCash)}</span>
                </p>
              )}
              <div className="sm:col-span-2">
                <Button disabled={close.isPending || counted === ''} onClick={() => close.mutate()}>
                  {close.isPending && <Loader2 className="animate-spin" />}
                  Close shift
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-6">
          {closed && <ShiftSummary shift={closed} />}
          <Card>
            <CardHeader>
              <CardTitle>Open a shift</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-4">
              <ErrorBox error={open.error ? errorMessage(open.error) : null} />
              <Field id="opening" label="Opening cash (₹)">
                <Input id="opening" type="number" min={0} step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)} />
              </Field>
              <Button disabled={open.isPending} onClick={() => open.mutate()}>
                {open.isPending && <Loader2 className="animate-spin" />}
                Open shift
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
