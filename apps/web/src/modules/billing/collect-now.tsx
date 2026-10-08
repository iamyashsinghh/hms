'use client';

// "Collect now": bills a patient's pending charges (all, or just one source's) and takes the money,
// without leaving the screen the charge was created on. Used by front office, lab, radiology and others.
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { billing as B } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { ErrorBox, MODE_LABELS, formatINR } from '@/modules/billing/ui';

export interface CollectNowProps {
  patientId: string;
  /** Only the charges this source posted (e.g. { module: 'lab', refId: orderId }); default: every pending charge. */
  source?: { module: string; refId: string };
  /** Only these charges. */
  chargeIds?: string[];
  /** Invoice source to stamp on the bill (defaults to the charge source). */
  invoiceSource?: { module: string; refId?: string };
  onDone?: (invoice: B.Invoice) => void;
  compact?: boolean;
}

/** Pending charges for the patient (filtered), a payment mode and one button that bills and collects. */
export function CollectNow({ patientId, source, chargeIds, invoiceSource, onDone, compact }: CollectNowProps) {
  const canCollect = usePermission('billing.payment.collect');
  const canBill = usePermission('billing.invoice.finalize');
  const queryClient = useQueryClient();
  const [mode, setMode] = React.useState<B.PaymentMode>('cash');
  const [reference, setReference] = React.useState('');
  const [done, setDone] = React.useState<B.Invoice | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['billing', 'charges', 'patient', patientId],
    queryFn: () => api.billing.charges.forPatient(patientId),
  });
  const charges = React.useMemo(() => {
    const all = (data?.groups ?? []).flatMap((g) => g.charges);
    return all.filter(
      (c) => (!source || (c.sourceModule === source.module && c.sourceRef === source.refId)) && (!chargeIds || chargeIds.includes(c.id)),
    );
  }, [data, source, chargeIds]);
  const total = charges.reduce((s, c) => s + Math.round(c.amount * 100), 0) / 100;
  const useDeposit = (data?.depositBalance ?? 0) > 0;
  const dueAfterAdvance = Math.max(0, total - (useDeposit ? (data?.depositBalance ?? 0) : 0));

  const collect = useMutation({
    mutationFn: () =>
      api.billing.charges.bill({
        patientId,
        chargeIds: charges.map((c) => c.id),
        useDeposit,
        payNow: dueAfterAdvance > 0 ? { mode, amount: dueAfterAdvance, ref: reference.trim() || undefined } : undefined,
        source: invoiceSource ?? (source ? { module: source.module, refId: source.refId } : undefined),
      }),
    onSuccess: (inv) => {
      setDone(inv);
      queryClient.invalidateQueries({ queryKey: ['billing'] });
      onDone?.(inv);
    },
  });

  if (!canBill || !canCollect) return null;
  if (done) {
    return (
      <p className="text-sm">
        Paid on bill{' '}
        <Link className="font-medium underline" href={`/billing/invoices/${done.id}`}>
          {done.number}
        </Link>{' '}
        · {formatINR(done.total)}
      </p>
    );
  }
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading charges…</p>;
  if (error) return <ErrorBox error={errorMessage(error)} />;
  if (!charges.length) return compact ? null : <p className="text-sm text-muted-foreground">Nothing pending to collect.</p>;

  return (
    <div className="space-y-2 rounded-md border p-3">
      <ErrorBox error={collect.error ? errorMessage(collect.error) : null} />
      {!compact && (
        <ul className="space-y-1 text-sm">
          {charges.map((c) => (
            <li key={c.id} className="flex justify-between gap-2">
              <span className="min-w-0 truncate">
                {c.description}
                {c.qty !== 1 && <span className="text-muted-foreground"> × {c.qty}</span>}
              </span>
              <span className="tabular-nums">{formatINR(c.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Total {formatINR(total)}</span>
        {useDeposit && <span className="text-xs text-muted-foreground">advance {formatINR(data!.depositBalance)} used first</span>}
        {dueAfterAdvance > 0 && (
          <>
            <Select aria-label="Payment mode" className="w-32" value={mode} onChange={(e) => setMode(e.target.value as B.PaymentMode)}>
              {B.PAYMENT_MODES.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </Select>
            {mode !== 'cash' && (
              <Input aria-label="Reference" className="w-40" placeholder="Txn / ref no." value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} />
            )}
          </>
        )}
        <Button type="button" size="sm" disabled={collect.isPending} onClick={() => collect.mutate()}>
          {collect.isPending && <Loader2 className="animate-spin" />}
          {dueAfterAdvance > 0 ? `Collect ${formatINR(dueAfterAdvance)}` : 'Bill from advance'}
        </Button>
      </div>
    </div>
  );
}

/** Small badge for queues and worklists: unpaid / paid / not billed. */
export function PaymentStateBadge({ state }: { state: B.SourcePaymentState | null | undefined }) {
  if (!state || state === 'none') return null;
  if (state === 'paid') return <Badge variant="accent">Paid</Badge>;
  return <Badge variant="destructive">{state === 'pending' ? 'Unpaid' : 'Bill due'}</Badge>;
}
