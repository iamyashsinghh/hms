'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { Can } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { expiryLabel, inr } from '@/modules/pharmacy/format';

/** Batches of one drug in a store, with stock adjustment / expiry write-off. */
export function BatchesDialog({ storeId, item, onClose }: { storeId: string; item: { id: string; name: string }; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: ['pharmacy', 'batches', storeId, item.id],
    queryFn: () => api.pharmacy.stock.batches(storeId, item.id),
  });
  const [adjusting, setAdjusting] = React.useState<string | null>(null);
  const [qty, setQty] = React.useState('');
  const [type, setType] = React.useState<'adjustment' | 'expiry_writeoff'>('adjustment');
  const [reason, setReason] = React.useState('');

  const adjust = useMutation({
    mutationFn: () => api.pharmacy.stock.adjust({ storeId, batchId: adjusting!, qtyChange: Number(qty), type, reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pharmacy'] });
      setAdjusting(null);
      setQty('');
      setReason('');
    },
  });

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16" onClick={onClose}>
      <Card className="w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{item.name}: batches</CardTitle>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <X />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-sm text-destructive">{errorMessage(error)}</p>}
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Batch</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead className="text-right">MRP</TableHead>
                <TableHead className="text-right">Sale rate</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : !data?.length ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    No stock in this store.
                  </TableCell>
                </TableRow>
              ) : (
                data.map((b) => (
                  <TableRow key={b.batchId}>
                    <TableCell className="font-mono text-xs">{b.batchNo}</TableCell>
                    <TableCell>
                      {expiryLabel(b.expiryDate)} {b.isExpired && <Badge variant="destructive">Expired</Badge>}
                    </TableCell>
                    <TableCell className="text-right">{inr(b.mrp)}</TableCell>
                    <TableCell className="text-right">{inr(b.saleRate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.qty}</TableCell>
                    <TableCell className="text-right">
                      <Can permission="pharmacy.stock.adjust">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setAdjusting(b.batchId);
                            setType(b.isExpired ? 'expiry_writeoff' : 'adjustment');
                            setQty(b.isExpired ? String(-b.qty) : '');
                          }}
                        >
                          Adjust
                        </Button>
                      </Can>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {adjusting && (
            <form
              className="grid gap-3 rounded-lg border p-4 sm:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                adjust.mutate();
              }}
            >
              <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                <option value="adjustment">Adjustment</option>
                <option value="expiry_writeoff">Expiry write-off</option>
              </Select>
              <Input type="number" placeholder="Qty (+ add / − remove)" value={qty} onChange={(e) => setQty(e.target.value)} required />
              <Input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
              <Button type="submit" disabled={adjust.isPending || !qty || Number(qty) === 0 || !reason.trim()}>
                {adjust.isPending && <Loader2 className="animate-spin" />} Save
              </Button>
              {adjust.error && <p className="text-sm text-destructive sm:col-span-4">{errorMessage(adjust.error)}</p>}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
