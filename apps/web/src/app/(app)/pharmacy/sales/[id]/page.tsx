'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Printer, Undo2 } from 'lucide-react';
import { pharmacy } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth, usePermission } from '@/lib/auth';
import { formatDate, fullName } from '@/lib/format';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { expiryLabel, inr } from '@/modules/pharmacy/format';

export default function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('pharmacy.sale.read');
  const canReturn = usePermission('pharmacy.sale.return');
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: sale, isPending, error } = useQuery({ queryKey: ['pharmacy', 'sales', id], queryFn: () => api.pharmacy.sales.get(id), enabled: canRead });
  const { data: patient } = useQuery({
    queryKey: ['patients', sale?.patientId],
    queryFn: () => api.patients.get(sale!.patientId!),
    enabled: !!sale?.patientId && (user?.permissions.includes('core.patient.read') ?? false),
  });
  const [returning, setReturning] = React.useState(false);
  const [retQty, setRetQty] = React.useState<Record<string, number>>({});
  const [refundMode, setRefundMode] = React.useState<(typeof pharmacy.PAYMENT_MODES)[number]>('cash');
  const [reason, setReason] = React.useState('');

  const doReturn = useMutation({
    mutationFn: () =>
      api.pharmacy.sales.createReturn(id, {
        reason: reason || undefined,
        refundMode,
        lines: Object.entries(retQty)
          .filter(([, q]) => q > 0)
          .map(([saleLineId, qty]) => ({ saleLineId, qty })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pharmacy'] });
      setReturning(false);
      setRetQty({});
      setReason('');
    },
  });

  if (!canRead) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;

  const customer = patient ? `${fullName(patient)} (${patient.uhid})` : (sale.customerName ?? 'Walk-in customer');
  const lines = sale.lines ?? [];
  const canStillReturn = lines.some((l) => l.returnedQty < l.qty);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/pharmacy/sales" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
          <ArrowLeft /> All sales
        </Link>
        <div className="flex gap-2">
          {canReturn && canStillReturn && (
            <Button variant="outline" onClick={() => setReturning((r) => !r)}>
              <Undo2 /> Return items
            </Button>
          )}
          <Button onClick={() => window.print()}>
            <Printer /> Print bill
          </Button>
        </div>
      </div>

      <Card className="print:border-0 print:shadow-none">
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-lg font-semibold">{user?.tenantName}</div>
            <div className="text-sm text-muted-foreground">Pharmacy bill {sale.type === 'rx' ? '(prescription)' : ''}</div>
          </div>
          <div className="text-right text-sm">
            <div className="font-mono text-base font-semibold">{sale.number}</div>
            <div>{formatDate(sale.createdAt)}</div>
            {sale.invoiceNumber && <div className="text-muted-foreground">Invoice {sale.invoiceNumber}</div>}
            {sale.status !== 'completed' && <Badge variant="destructive">{sale.status === 'returned' ? 'Fully returned' : 'Partly returned'}</Badge>}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm">
            <span className="text-muted-foreground">Customer: </span>
            {customer}
            {sale.customerMobile && ` · ${sale.customerMobile}`}
          </div>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Item</TableHead>
                <TableHead>Batch / Exp</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Disc</TableHead>
                <TableHead className="text-right">GST</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                {returning && <TableHead className="print:hidden">Return qty</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.itemName}</TableCell>
                  <TableCell className="text-xs">
                    <span className="font-mono">{l.batchNo}</span> · {expiryLabel(l.expiryDate)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.qty}
                    {l.returnedQty > 0 && <span className="text-xs text-destructive"> (−{l.returnedQty})</span>}
                  </TableCell>
                  <TableCell className="text-right">{inr(l.unitPrice)}</TableCell>
                  <TableCell className="text-right">{l.discountPct ? `${l.discountPct}%` : '—'}</TableCell>
                  <TableCell className="text-right">{l.gstRate}%</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(l.amount)}</TableCell>
                  {returning && (
                    <TableCell className="print:hidden">
                      <Input
                        type="number"
                        className="w-20"
                        min={0}
                        max={l.qty - l.returnedQty}
                        disabled={l.qty === l.returnedQty}
                        value={retQty[l.id] ?? ''}
                        onChange={(e) => setRetQty({ ...retQty, [l.id]: Math.min(l.qty - l.returnedQty, Math.max(0, Number(e.target.value) || 0)) })}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <dl className="ml-auto grid max-w-xs grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Gross</dt>
            <dd className="text-right tabular-nums">{inr(sale.subtotal)}</dd>
            <dt className="text-muted-foreground">Discount</dt>
            <dd className="text-right tabular-nums">−{inr(sale.discount)}</dd>
            <dt className="text-muted-foreground">Taxable value</dt>
            <dd className="text-right tabular-nums">{inr(sale.taxableAmount)}</dd>
            <dt className="text-muted-foreground">GST</dt>
            <dd className="text-right tabular-nums">{inr(sale.taxAmount)}</dd>
            <dt className="font-semibold">Total</dt>
            <dd className="text-right font-semibold tabular-nums">{inr(sale.total)}</dd>
            {sale.returnedAmount > 0 && (
              <>
                <dt className="text-destructive">Refunded</dt>
                <dd className="text-right tabular-nums text-destructive">−{inr(sale.returnedAmount)}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Paid by</dt>
            <dd className="text-right uppercase">{sale.paymentMode ?? '—'}</dd>
          </dl>
        </CardContent>
      </Card>

      {returning && (
        <Card className="print:hidden">
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
            <Input className="max-w-sm" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Select aria-label="Refund mode" className="w-32" value={refundMode} onChange={(e) => setRefundMode(e.target.value as typeof refundMode)}>
              {pharmacy.PAYMENT_MODES.map((m) => (
                <option key={m} value={m}>
                  {m.toUpperCase()}
                </option>
              ))}
            </Select>
            <Button disabled={doReturn.isPending || !Object.values(retQty).some((q) => q > 0)} onClick={() => doReturn.mutate()}>
              {doReturn.isPending && <Loader2 className="animate-spin" />} Confirm return
            </Button>
            {doReturn.error && <p className="w-full text-sm text-destructive">{errorMessage(doReturn.error)}</p>}
          </CardContent>
        </Card>
      )}

      {sale.returns.length > 0 && (
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle>Returns</CardTitle>
          </CardHeader>
          <Table>
            <TableBody>
              {sale.returns.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.number}</TableCell>
                  <TableCell>{formatDate(r.createdAt)}</TableCell>
                  <TableCell>{r.reason ?? '—'}</TableCell>
                  <TableCell className="uppercase">{r.refundMode}</TableCell>
                  <TableCell className="font-mono text-xs">{[r.creditNoteNumber, r.billingRefundNumber].filter(Boolean).join(' · ') || '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(r.refundAmount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
