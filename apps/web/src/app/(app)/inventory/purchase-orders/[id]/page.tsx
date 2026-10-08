'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, PackageCheck, Pencil, Printer } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { inr, Notice, StatusBadge } from '@/modules/inventory/ui';

interface Receipt {
  qty: string;
  freeQty: string;
  batchNo: string;
  expiryDate: string;
  mrp: string;
}

export default function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('inventory.purchase.read');
  const canOrder = usePermission('inventory.purchase.order');
  const canApprove = usePermission('inventory.purchase.approve');
  const canReceive = usePermission('inventory.grn.create');
  const queryClient = useQueryClient();
  const [receiving, setReceiving] = React.useState(false);
  const [invoice, setInvoice] = React.useState({ invoiceNo: '', invoiceDate: '' });
  const [receipt, setReceipt] = React.useState<Record<string, Receipt>>({});
  const [notice, setNotice] = React.useState<string | null>(null);

  const po = useQuery({ queryKey: ['inventory', 'purchase-orders', id], queryFn: () => api.inventory.purchaseOrders.get(id), enabled: canRead });
  const grns = useQuery({ queryKey: ['inventory', 'grns', 'po', id], queryFn: () => api.inventory.grns.list({ purchaseOrderId: id, pageSize: 100 }), enabled: canRead });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['inventory'] });

  const act = useMutation({
    mutationFn: async (action: 'approve' | 'cancel' | 'close') => {
      if (action === 'approve') return api.inventory.purchaseOrders.approve(id);
      const reason = window.prompt(action === 'cancel' ? 'Why cancel this PO?' : 'Why close this PO without the remaining goods?');
      if (!reason?.trim()) return null;
      return action === 'cancel' ? api.inventory.purchaseOrders.cancel(id, { reason }) : api.inventory.purchaseOrders.close(id, { reason });
    },
    onSuccess: refresh,
  });

  const receive = useMutation({
    mutationFn: () =>
      api.inventory.grns.create({
        purchaseOrderId: id,
        invoiceNo: invoice.invoiceNo || undefined,
        invoiceDate: invoice.invoiceDate || undefined,
        lines: Object.entries(receipt)
          .filter(([, r]) => Number(r.qty) > 0)
          .map(([poLineId, r]) => ({
            poLineId,
            qty: Number(r.qty),
            freeQty: Number(r.freeQty || 0),
            batchNo: r.batchNo.trim() || undefined,
            expiryDate: r.expiryDate || undefined,
            mrp: r.mrp ? Number(r.mrp) : undefined,
          })),
      }),
    onSuccess: (g) => {
      refresh();
      setReceiving(false);
      setReceipt({});
      setInvoice({ invoiceNo: '', invoiceDate: '' });
      setNotice(`${g.number} posted for ${inr(g.total)}. Stock is in ${po.data?.storeName}.`);
    },
  });

  if (!canRead) return <NoAccess />;
  if (po.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (po.error) return <p className="text-sm text-destructive">{errorMessage(po.error)}</p>;
  const p = po.data;
  const lines = p.lines ?? [];
  const receivable = p.status === 'approved' || p.status === 'partially_received';
  const startReceiving = () => {
    setReceipt(Object.fromEntries(lines.filter((l) => l.pendingQty > 0).map((l) => [l.id, { qty: String(l.pendingQty), freeQty: '', batchNo: '', expiryDate: '', mrp: '' }])));
    setReceiving(true);
  };
  const setR = (lineId: string, patch: Partial<Receipt>) => setReceipt((r) => ({ ...r, [lineId]: { ...r[lineId]!, ...patch } }));

  return (
    <>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/inventory/purchase-orders" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Purchase orders
        </Link>
        <div className="flex gap-2">
          {canOrder && p.status === 'draft' && (
            <Link href={`/inventory/purchase-orders/${id}/edit`} className={buttonVariants({ variant: 'outline' })}>
              <Pencil /> Edit
            </Link>
          )}
          {canApprove && p.status === 'draft' && (
            <Button disabled={act.isPending} onClick={() => act.mutate('approve')}>
              Approve
            </Button>
          )}
          {canReceive && receivable && !receiving && (
            <Button onClick={startReceiving}>
              <PackageCheck /> Receive goods
            </Button>
          )}
          {canApprove && (p.status === 'draft' || p.status === 'approved') && (
            <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate('cancel')}>
              Cancel PO
            </Button>
          )}
          {canApprove && p.status === 'partially_received' && (
            <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate('close')}>
              Short-close
            </Button>
          )}
          <Button variant="outline" onClick={() => window.print()}>
            <Printer /> Print
          </Button>
        </div>
      </div>
      {notice && <Notice>{notice}</Notice>}
      {act.error && <Notice tone="error">{errorMessage(act.error)}</Notice>}

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-xl">Purchase order {p.number}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDate(p.createdAt)} · deliver to {p.storeName}
                {p.expectedDate && ` by ${formatDate(p.expectedDate)}`}
              </p>
            </div>
            <StatusBadge status={p.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <span className="text-muted-foreground">Vendor: </span>
              <span className="font-medium">{p.vendorName}</span>
            </div>
            {p.terms && (
              <div>
                <span className="text-muted-foreground">Terms: </span>
                {p.terms}
              </div>
            )}
            {p.closedReason && (
              <div className="sm:col-span-2">
                <span className="text-muted-foreground">Reason closed: </span>
                {p.closedReason}
              </div>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>#</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Ordered</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">GST</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.lineNo}</TableCell>
                  <TableCell>
                    <div className="font-medium">{l.itemName}</div>
                    <div className="text-xs text-muted-foreground">{l.itemCode}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.qty} {l.unit}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{l.receivedQty}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(l.rate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.gstRate}%</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(l.amount)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="text-right text-muted-foreground">
                  Subtotal {inr(p.subtotal)} · GST {inr(p.taxTotal)} · <span className="font-semibold text-foreground">Total</span>
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{inr(p.total)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          {p.status === 'draft' && canOrder && <p className="text-xs text-muted-foreground">Drafts can be changed until approved.</p>}
        </CardContent>
      </Card>

      {receiving && (
        <Card className="mb-6 print:hidden">
          <CardHeader>
            <CardTitle>Receive goods</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <div>
                <Label htmlFor="grn-inv">Vendor invoice no.</Label>
                <Input id="grn-inv" className="mt-2" value={invoice.invoiceNo} onChange={(e) => setInvoice({ ...invoice, invoiceNo: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="grn-date">Invoice date</Label>
                <Input id="grn-date" type="date" className="mt-2" value={invoice.invoiceDate} onChange={(e) => setInvoice({ ...invoice, invoiceDate: e.target.value })} />
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Item</TableHead>
                  <TableHead>Pending</TableHead>
                  <TableHead>Accepted qty</TableHead>
                  <TableHead>Free</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>MRP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines
                  .filter((l) => receipt[l.id])
                  .map((l) => {
                    const r = receipt[l.id]!;
                    return (
                      <TableRow key={l.id}>
                        <TableCell className="font-medium">{l.itemName}</TableCell>
                        <TableCell className="tabular-nums">{l.pendingQty}</TableCell>
                        <TableCell>
                          <Input className="w-20" type="number" min={0} max={l.pendingQty} aria-label={`Qty of ${l.itemName}`} value={r.qty} onChange={(e) => setR(l.id, { qty: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          <Input className="w-16" type="number" min={0} aria-label={`Free qty of ${l.itemName}`} value={r.freeQty} onChange={(e) => setR(l.id, { freeQty: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          <Input className="w-28" placeholder="NA" aria-label={`Batch of ${l.itemName}`} value={r.batchNo} onChange={(e) => setR(l.id, { batchNo: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          <Input className="w-36" type="date" aria-label={`Expiry of ${l.itemName}`} value={r.expiryDate} onChange={(e) => setR(l.id, { expiryDate: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          <Input className="w-24" type="number" min={0} step="0.01" placeholder="auto" aria-label={`MRP of ${l.itemName}`} value={r.mrp} onChange={(e) => setR(l.id, { mrp: e.target.value })} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">Leave batch and expiry empty for consumables without batches. MRP defaults to rate plus GST.</p>
            {receive.error && <p className="text-sm text-destructive">{errorMessage(receive.error)}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setReceiving(false)}>
                Cancel
              </Button>
              <Button disabled={receive.isPending || !Object.values(receipt).some((r) => Number(r.qty) > 0)} onClick={() => receive.mutate()}>
                {receive.isPending && <Loader2 className="animate-spin" />}
                Post GRN
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Goods received</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>GRN</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grns.data?.items.length ? (
              grns.data.items.map((g) => (
                <TableRow key={g.id}>
                  <TableCell>
                    <Link className="font-mono text-xs text-primary hover:underline" href={`/inventory/grns/${g.id}`}>
                      {g.number}
                    </Link>
                  </TableCell>
                  <TableCell>{g.invoiceNo ?? '—'}</TableCell>
                  <TableCell>{formatDate(g.createdAt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(g.total)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                  Nothing received yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
