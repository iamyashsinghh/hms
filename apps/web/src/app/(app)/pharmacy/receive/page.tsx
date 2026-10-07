'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2 } from 'lucide-react';
import type { pharmacy } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { inr } from '@/modules/pharmacy/format';
import { ItemPicker } from '@/modules/pharmacy/item-picker';
import { StorePicker, useActiveStore } from '@/modules/pharmacy/use-store';

interface Line {
  key: number;
  item: pharmacy.Item;
  batchNo: string;
  expiryDate: string;
  qty: string;
  freeQty: string;
  purchaseRate: string;
  mrp: string;
}

let nextKey = 1;

export default function ReceiveStockPage() {
  const canReceive = usePermission('pharmacy.stock.receive');
  const queryClient = useQueryClient();
  const active = useActiveStore();
  const storeId = active.store?.id;
  const [mode, setMode] = React.useState<'grn' | 'opening'>('grn');
  const [supplier, setSupplier] = React.useState({ supplierName: '', supplierGstin: '', invoiceNo: '', invoiceDate: '' });
  const [lines, setLines] = React.useState<Line[]>([]);
  const [done, setDone] = React.useState<string | null>(null);

  const grns = useQuery({ queryKey: ['pharmacy', 'grns'], queryFn: () => api.pharmacy.grns.list({ pageSize: 10 }), enabled: canReceive });

  const set = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const toLine = (l: Line) => ({
    itemId: l.item.id,
    batchNo: l.batchNo.trim(),
    expiryDate: l.expiryDate,
    qty: Number(l.qty),
    mrp: Number(l.mrp),
    purchaseRate: Number(l.purchaseRate || 0),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (mode === 'opening') {
        const r = await api.pharmacy.stock.opening({ storeId: storeId!, lines: lines.map(toLine) });
        return `Opening stock saved: ${r.units} units in ${r.lines} lines.`;
      }
      const g = await api.pharmacy.grns.create({
        storeId: storeId!,
        supplierName: supplier.supplierName,
        supplierGstin: supplier.supplierGstin || undefined,
        invoiceNo: supplier.invoiceNo || undefined,
        invoiceDate: supplier.invoiceDate || undefined,
        lines: lines.map((l) => ({ ...toLine(l), freeQty: Number(l.freeQty || 0) })),
      });
      return `${g.number} posted for ${inr(g.totalAmount)}.`;
    },
    onSuccess: (msg) => {
      queryClient.invalidateQueries({ queryKey: ['pharmacy'] });
      setDone(msg);
      setLines([]);
      setSupplier({ supplierName: '', supplierGstin: '', invoiceNo: '', invoiceDate: '' });
    },
  });

  if (!canReceive) return <NoAccess />;
  const valid =
    !!storeId &&
    lines.length > 0 &&
    lines.every((l) => l.batchNo.trim() && l.expiryDate && Number(l.qty) > 0 && Number(l.mrp) > 0) &&
    (mode === 'opening' || supplier.supplierName.trim().length > 0);
  const total = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.purchaseRate || 0) * (1 + l.item.gstRate / 100), 0);

  return (
    <>
      <PageHeader
        title="Receive stock"
        description="Goods receipt from a supplier, or opening stock when you start using the system."
        actions={<StorePicker active={active} />}
      />
      <div className="mb-4 inline-flex rounded-md border p-0.5 text-sm">
        {(['grn', 'opening'] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={`rounded px-3 py-1.5 ${mode === m ? 'bg-primary text-primary-foreground' : ''}`}
            onClick={() => setMode(m)}
          >
            {m === 'grn' ? 'Supplier GRN' : 'Opening stock'}
          </button>
        ))}
      </div>
      {done && <p className="mb-4 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary">{done}</p>}

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          setDone(null);
          save.mutate();
        }}
      >
        {mode === 'grn' && (
          <Card>
            <CardHeader>
              <CardTitle>Supplier invoice</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-4">
              <div className="sm:col-span-2">
                <Label htmlFor="supplier">Supplier *</Label>
                <Input id="supplier" className="mt-2" value={supplier.supplierName} onChange={(e) => setSupplier({ ...supplier, supplierName: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="gstin">Supplier GSTIN</Label>
                <Input id="gstin" className="mt-2" value={supplier.supplierGstin} onChange={(e) => setSupplier({ ...supplier, supplierGstin: e.target.value.toUpperCase() })} />
              </div>
              <div>
                <Label htmlFor="inv">Invoice no.</Label>
                <Input id="inv" className="mt-2" value={supplier.invoiceNo} onChange={(e) => setSupplier({ ...supplier, invoiceNo: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="invDate">Invoice date</Label>
                <Input id="invDate" type="date" className="mt-2" value={supplier.invoiceDate} onChange={(e) => setSupplier({ ...supplier, invoiceDate: e.target.value })} />
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ItemPicker
              onPick={(item) =>
                setLines((ls) => [...ls, { key: nextKey++, item, batchNo: '', expiryDate: '', qty: '', freeQty: '', purchaseRate: '', mrp: '' }])
              }
            />
            {lines.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Drug</TableHead>
                    <TableHead>Batch *</TableHead>
                    <TableHead>Expiry *</TableHead>
                    <TableHead>Qty *</TableHead>
                    {mode === 'grn' && <TableHead>Free</TableHead>}
                    <TableHead>Rate (ex GST)</TableHead>
                    <TableHead>MRP *</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={l.key}>
                      <TableCell>
                        <div className="font-medium">{l.item.name}</div>
                        <div className="text-xs text-muted-foreground">
                          per {l.item.unit} · GST {l.item.gstRate}%
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input className="w-28" value={l.batchNo} onChange={(e) => set(l.key, { batchNo: e.target.value })} />
                      </TableCell>
                      <TableCell>
                        <Input className="w-36" type="date" value={l.expiryDate} onChange={(e) => set(l.key, { expiryDate: e.target.value })} />
                      </TableCell>
                      <TableCell>
                        <Input className="w-20" type="number" min={1} value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} />
                      </TableCell>
                      {mode === 'grn' && (
                        <TableCell>
                          <Input className="w-16" type="number" min={0} value={l.freeQty} onChange={(e) => set(l.key, { freeQty: e.target.value })} />
                        </TableCell>
                      )}
                      <TableCell>
                        <Input className="w-24" type="number" min={0} step="0.01" value={l.purchaseRate} onChange={(e) => set(l.key, { purchaseRate: e.target.value })} />
                      </TableCell>
                      <TableCell>
                        <Input className="w-24" type="number" min={0} step="0.01" value={l.mrp} onChange={(e) => set(l.key, { mrp: e.target.value })} />
                      </TableCell>
                      <TableCell>
                        <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                          <Trash2 />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {save.error && <p className="text-sm text-destructive">{errorMessage(save.error)}</p>}
        <div className="flex items-center justify-end gap-4">
          {mode === 'grn' && lines.length > 0 && <span className="text-sm text-muted-foreground">Invoice value ≈ {inr(total)}</span>}
          <Button type="submit" disabled={!valid || save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />}
            {mode === 'grn' ? 'Post GRN' : 'Save opening stock'}
          </Button>
        </div>
      </form>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Recent GRNs</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>GRN</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grns.data?.items.length ? (
              grns.data.items.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-mono text-xs">{g.number}</TableCell>
                  <TableCell>{g.supplierName}</TableCell>
                  <TableCell>{g.invoiceNo ?? '—'}</TableCell>
                  <TableCell>{formatDate(g.createdAt)}</TableCell>
                  <TableCell className="text-right">{inr(g.totalAmount)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  No GRNs yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
