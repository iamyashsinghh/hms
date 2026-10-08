'use client';

// "Credit notes suggested": billed charges whose order was cancelled afterwards. One click issues the
// credit note for that bill line (and the refund, when the bill was already paid).
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Undo2 } from 'lucide-react';
import { billing as B } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { formatDate } from '@/lib/format';
import { ErrorBox, MODE_LABELS, formatINR, sourceLabel } from '@/modules/billing/ui';

export function SuggestedCredits({ reversals, showBill = true, onDone }: { reversals: B.Charge[]; showBill?: boolean; onDone?: (inv: B.Invoice) => void }) {
  if (!reversals.length) return null;
  return (
    <Card className="border-amber-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Undo2 className="size-4" /> Credit notes suggested
        </CardTitle>
        <p className="text-sm text-muted-foreground">These were billed, then the order was cancelled. Issue a credit note so the patient does not pay for them.</p>
      </CardHeader>
      <CardContent className="divide-y p-0">
        {reversals.map((c) => (
          <ReversalRow key={c.id} charge={c} showBill={showBill} onDone={onDone} />
        ))}
      </CardContent>
    </Card>
  );
}

function ReversalRow({ charge, showBill, onDone }: { charge: B.Charge; showBill: boolean; onDone?: (inv: B.Invoice) => void }) {
  const canCredit = usePermission('billing.creditnote.create');
  const queryClient = useQueryClient();
  const [refundMode, setRefundMode] = React.useState<B.PaymentMode>('cash');
  const { data: inv } = useQuery({
    queryKey: ['billing', 'invoices', charge.invoiceId],
    queryFn: () => api.billing.invoices.get(charge.invoiceId!),
    enabled: !!charge.invoiceId && canCredit,
  });
  // Money comes back only for the part of the line already paid; the API asks for a mode then.
  const paid = (inv?.paidAmount ?? 0) > 0;
  const credit = useMutation({
    mutationFn: () => api.billing.charges.credit(charge.id, paid ? { refundMode } : {}),
    onSuccess: (next) => {
      queryClient.invalidateQueries({ queryKey: ['billing'] });
      onDone?.(next);
    },
  });

  return (
    <div className="space-y-2 px-6 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{charge.description}</div>
          <div className="text-xs text-muted-foreground">
            {sourceLabel(charge.sourceModule)} · {formatDate(charge.chargeDate)}
            {showBill && charge.invoiceId && (
              <>
                {' · bill '}
                <Link className="underline" href={`/billing/invoices/${charge.invoiceId}`}>
                  {charge.invoiceNumber ?? 'view'}
                </Link>
              </>
            )}
            {charge.reversalReason && ` · ${charge.reversalReason}`}
          </div>
        </div>
        <span className="tabular-nums">{formatINR(charge.amount)}</span>
      </div>
      {canCredit && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {paid && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Refund by
              <Select aria-label="Refund mode" className="h-8 w-32" value={refundMode} onChange={(e) => setRefundMode(e.target.value as B.PaymentMode)}>
                {B.PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABELS[m]}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <Button size="sm" variant="outline" disabled={credit.isPending} onClick={() => credit.mutate()}>
            {credit.isPending && <Loader2 className="animate-spin" />}
            Issue credit note
          </Button>
        </div>
      )}
      <ErrorBox error={credit.error ? errorMessage(credit.error) : null} />
    </div>
  );
}
