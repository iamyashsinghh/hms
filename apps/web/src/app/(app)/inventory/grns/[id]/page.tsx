'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Undo2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { expiryLabel } from '@/modules/pharmacy/format';
import { inr, Notice } from '@/modules/inventory/ui';

export default function GrnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('inventory.purchase.read');
  const canReturn = usePermission('inventory.grn.create');
  const queryClient = useQueryClient();
  const [returning, setReturning] = React.useState(false);
  const [qty, setQty] = React.useState<Record<string, string>>({});
  const [reason, setReason] = React.useState('');
  const [returnError, setReturnError] = React.useState<string | null>(null);

  const grn = useQuery({ queryKey: ['inventory', 'grns', id], queryFn: () => api.inventory.grns.get(id), enabled: canRead });
  const doReturn = useMutation({
    mutationFn: () =>
      api.inventory.grns.createReturn(id, {
        reason,
        lines: Object.entries(qty)
          .filter(([, q]) => Number(q) > 0)
          .map(([grnLineId, q]) => ({ grnLineId, qty: Number(q) })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['pharmacy'] });
      setReturning(false);
      setQty({});
      setReason('');
    },
  });

  if (!canRead) return <NoAccess />;
  if (grn.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (grn.error) return <p className="text-sm text-destructive">{errorMessage(grn.error)}</p>;
  const g = grn.data;
  const lines = g.lines ?? [];
  const returnable = (l: (typeof lines)[number]) => l.qty + l.freeQty - l.returnedQty;

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <Link href={`/inventory/purchase-orders/${g.purchaseOrderId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> {g.poNumber ?? 'Purchase order'}
        </Link>
        {canReturn && !returning && lines.some((l) => returnable(l) > 0) && (
          <Button variant="outline" onClick={() => setReturning(true)}>
            <Undo2 /> Return to vendor
          </Button>
        )}
      </div>
      {doReturn.data && <Notice>{`${doReturn.data.number} recorded for ${inr(doReturn.data.total)}.`}</Notice>}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-xl">GRN {g.number}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {formatDate(g.createdAt)} · {g.vendorName}
            {g.invoiceNo && ` · invoice ${g.invoiceNo}`}
            {g.invoiceDate && ` of ${formatDate(g.invoiceDate)}`}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
              <TableHead>Item</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>Expiry</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Free</TableHead>
              <TableHead className="text-right">Returned</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              {returning && <TableHead>Return qty</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.itemName}</TableCell>
                  <TableCell className="font-mono text-xs">{l.batchNo}</TableCell>
                  <TableCell>{l.expiryDate === '2099-12-31' ? '—' : expiryLabel(l.expiryDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.freeQty || '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.returnedQty || '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(l.rate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(l.amount)}</TableCell>
                  {returning && (
                    <TableCell>
                      <Input
                        className="w-20"
                        type="number"
                        min={0}
                        step={1}
                        max={returnable(l)}
                        disabled={returnable(l) === 0}
                        aria-label={`Return qty of ${l.itemName}`}
                        value={qty[l.id] ?? ''}
                        onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="text-right font-semibold">
                  Total
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{inr(g.total)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          {returning && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Input className="max-w-sm" maxLength={300} placeholder="Reason (damaged, wrong item, near expiry…) *" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button variant="outline" onClick={() => setReturning(false)}>
                Cancel
              </Button>
              <Button disabled={!reason.trim() || !Object.values(qty).some((q) => Number(q) > 0) || doReturn.isPending} onClick={() => {
                  // Whole units, no more than received + free - already returned.
                  let problem: string | null = null;
                  for (const l of lines) {
                    const n = Number(qty[l.id] || 0);
                    if (!Number.isInteger(n) || n < 0) problem = `${l.itemName}: enter a whole number`;
                    else if (n > returnable(l)) problem = `${l.itemName}: only ${returnable(l)} can still be returned`;
                    if (problem) break;
                  }
                  setReturnError(problem);
                  if (!problem) doReturn.mutate();
                }}>
                {doReturn.isPending && <Loader2 className="animate-spin" />}
                Record return
              </Button>
            </div>
          )}
          {(returnError || doReturn.error) && <p className="text-right text-sm text-destructive">{returnError ?? errorMessage(doReturn.error)}</p>}
        </CardContent>
      </Card>

      {!!g.returns?.length && (
        <Card>
          <CardHeader>
            <CardTitle>Returns to vendor</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Number</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {g.returns.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.number}</TableCell>
                  <TableCell>{formatDate(r.createdAt)}</TableCell>
                  <TableCell>{r.reason}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.lines.reduce((s, l) => s + l.qty, 0)}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(r.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
