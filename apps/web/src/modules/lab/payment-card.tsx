'use client';

// Payment block for a diagnostics order (lab and radiology): what the order put on the patient's account,
// "Collect now" for its pending charges, and the bill once it is billed. The hospital's billing rules decide
// whether payment comes before the sample / scan (payFirst); this only warns, it never blocks.
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, ReceiptIndianRupee } from 'lucide-react';
import type { billing as B } from '@hms/shared';
import { Can } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CollectNow, PaymentStateBadge } from '@/modules/billing/collect-now';

export interface OrderPaymentCardProps {
  patientId: string;
  source: { module: 'lab' | 'radiology'; refId: string };
  paymentState: B.SourcePaymentState;
  payFirst: boolean;
  invoiceId: string | null;
  invoiceNo: string | null;
  /** Order still open (not cancelled). */
  open: boolean;
  /** "sample" (lab) or "scan" (radiology), for the pay-first warning. */
  step: 'sample' | 'scan';
  /** Bill the order now when nothing is on the account yet (the hospital charges later, e.g. at collection). */
  billNow?: { permission: string; disabled?: boolean; onClick: () => void };
  /** Called after Collect now billed the charges (refresh the order). */
  onBilled: () => void;
  className?: string;
}

/** Unpaid while the hospital wants payment first. */
export function needsPayment(o: { paymentState: B.SourcePaymentState; payFirst: boolean }) {
  return o.payFirst && (o.paymentState === 'pending' || o.paymentState === 'unpaid');
}

export function OrderPaymentCard({
  patientId,
  source,
  paymentState,
  payFirst,
  invoiceId,
  invoiceNo,
  open,
  step,
  billNow,
  onBilled,
  className = 'mb-6',
}: OrderPaymentCardProps) {
  const queryClient = useQueryClient();
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          Payment <PaymentStateBadge state={paymentState} />
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          {invoiceId && (
            <Can
              permission="billing.invoice.read"
              fallback={<Badge variant="outline">Bill {invoiceNo}</Badge>}
            >
              <Link
                href={`/billing/invoices/${invoiceId}`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <ReceiptIndianRupee /> {invoiceNo ?? 'Bill'}
              </Link>
            </Can>
          )}
          <Can permission="billing.invoice.create">
            <Link
              href={`/billing/new?patientId=${patientId}`}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              <ExternalLink /> Open in billing
            </Link>
          </Can>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {open && needsPayment({ paymentState, payFirst }) && (
          <p className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="size-4 shrink-0" /> Unpaid. This hospital takes payment before
            the {step}.
          </p>
        )}
        {paymentState === 'pending' && (
          <CollectNow
            patientId={patientId}
            source={source}
            onDone={() => {
              queryClient.invalidateQueries({ queryKey: [source.module] });
              onBilled();
            }}
          />
        )}
        {paymentState === 'none' && open && !invoiceId && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              Not on the patient&apos;s account yet; the hospital&apos;s billing rules may charge it
              when the {step} is done.
            </span>
            {billNow && (
              <Can permission={billNow.permission}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={billNow.disabled}
                  onClick={billNow.onClick}
                >
                  <ReceiptIndianRupee /> Bill now
                </Button>
              </Can>
            )}
          </div>
        )}
        {paymentState === 'unpaid' && (
          <p className="text-sm text-muted-foreground">Billed, payment due on the bill.</p>
        )}
        {paymentState === 'paid' && <p className="text-sm text-muted-foreground">Paid.</p>}
      </CardContent>
    </Card>
  );
}
