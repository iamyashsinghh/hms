'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { expiryLabel, inr } from '@/modules/pharmacy/format';
import { StorePicker, useActiveStore } from '@/modules/pharmacy/use-store';
import { BatchesDialog } from '@/modules/pharmacy/batches-dialog';

export default function ExpiryPage() {
  const canRead = usePermission('pharmacy.stock.read');
  const active = useActiveStore();
  const storeId = active.store?.id;
  const [days, setDays] = React.useState(90);
  const [open, setOpen] = React.useState<{ id: string; name: string } | null>(null);
  const { data, isPending, error } = useQuery({
    queryKey: ['pharmacy', 'expiring', storeId, days],
    queryFn: () => api.pharmacy.stock.expiring({ storeId: storeId!, days }),
    enabled: canRead && !!storeId,
  });
  if (!canRead) return <NoAccess />;
  const value = data?.reduce((s, b) => s + b.qty * b.purchaseRate, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Expiry alerts"
        description={data ? `${data.length} batches, stock value ${inr(value)} at purchase rate` : 'Batches that have expired or will expire soon.'}
        actions={
          <>
            <StorePicker active={active} />
            <Select aria-label="Window" className="w-40" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={0}>Already expired</option>
              <option value={30}>Next 30 days</option>
              <option value={90}>Next 90 days</option>
              <option value={180}>Next 6 months</option>
            </Select>
          </>
        }
      />
      <Card>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Drug</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">MRP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!storeId || isPending ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    {storeId ? 'Loading…' : 'Pick a store.'}
                  </TableCell>
                </TableRow>
              ) : !data.length ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    Nothing expiring in this window.
                  </TableCell>
                </TableRow>
              ) : (
                data.map((b) => (
                  <TableRow key={b.batchId} className="cursor-pointer" onClick={() => setOpen({ id: b.itemId, name: b.itemName })}>
                    <TableCell>
                      <div className="font-medium">{b.itemName}</div>
                      <div className="font-mono text-xs text-muted-foreground">{b.itemCode}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{b.batchNo}</TableCell>
                    <TableCell>
                      {expiryLabel(b.expiryDate)}{' '}
                      {b.daysToExpiry < 0 ? (
                        <Badge variant="destructive">Expired</Badge>
                      ) : (
                        <Badge variant={b.daysToExpiry <= 30 ? 'destructive' : 'accent'}>{b.daysToExpiry} days</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.qty}</TableCell>
                    <TableCell className="text-right">{inr(b.mrp)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>
      {open && storeId && <BatchesDialog storeId={storeId} item={open} onClose={() => setOpen(null)} />}
    </>
  );
}
