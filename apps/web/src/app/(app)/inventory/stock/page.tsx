'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Notice, StoreSelect, useStores } from '@/modules/inventory/ui';

/** Stock per store with reorder alerts. Stock data comes from pharmacy, which owns the ledger. */
export default function StoreStockPage() {
  const canRead = usePermission('pharmacy.stock.read');
  const canRequest = usePermission('inventory.purchase.request');
  const { stores } = useStores();
  const [storeId, setStoreId] = React.useState('');
  const [lowOnly, setLowOnly] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [picked, setPicked] = React.useState<Record<string, number>>({});
  const activeStore = storeId || stores.find((s) => s.type === 'main')?.id || stores[0]?.id || '';

  const stock = useQuery({
    queryKey: ['pharmacy', 'stock', activeStore, lowOnly, q],
    queryFn: () => api.pharmacy.stock.list({ storeId: activeStore, lowOnly, q: q || undefined, pageSize: 200 }),
    enabled: canRead && !!activeStore,
  });

  const raise = useMutation({
    mutationFn: () =>
      api.inventory.requisitions.create({
        storeId: activeStore,
        notes: 'Raised from reorder levels',
        lines: Object.entries(picked).map(([itemId, qty]) => ({ itemId, qty })),
      }),
    onSuccess: () => setPicked({}),
  });

  if (!canRead) return <NoAccess />;
  const rows = stock.data?.items ?? [];
  const suggest = (r: { qty: number; reorderLevel: number }) => Math.max(r.reorderLevel * 2 - r.qty, 1);

  return (
    <>
      <PageHeader
        title="Store stock"
        description="What each store holds, and what has fallen to its reorder level."
        actions={<StoreSelect value={activeStore} onChange={setStoreId} stores={stores} />}
      />
      {raise.data && (
        <Notice>
          Requisition{' '}
          <Link className="underline" href="/inventory/requisitions">
            {raise.data.number}
          </Link>{' '}
          raised for {raise.data.lines?.length} items.
        </Notice>
      )}
      {raise.error && <Notice tone="error">{errorMessage(raise.error)}</Notice>}

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Input className="max-w-xs" placeholder="Search item…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> At or below reorder level
        </label>
        {canRequest && Object.keys(picked).length > 0 && (
          <Button className="ml-auto" disabled={raise.isPending} onClick={() => raise.mutate()}>
            {raise.isPending && <Loader2 className="animate-spin" />}
            Raise requisition ({Object.keys(picked).length})
          </Button>
        )}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {canRequest && <TableHead className="w-10" />}
              <TableHead>Item</TableHead>
              <TableHead className="text-right">In stock</TableHead>
              <TableHead className="text-right">Reorder level</TableHead>
              {canRequest && <TableHead className="text-right">Order qty</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((r) => {
                const low = r.reorderLevel > 0 && r.qty <= r.reorderLevel;
                const on = picked[r.itemId] !== undefined;
                return (
                  <TableRow key={r.itemId}>
                    {canRequest && (
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Order ${r.name}`}
                          checked={on}
                          onChange={(e) =>
                            setPicked((p) => {
                              const next = { ...p };
                              if (e.target.checked) next[r.itemId] = suggest(r);
                              else delete next[r.itemId];
                              return next;
                            })
                          }
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="font-medium">
                        {r.name} {low && <Badge variant="destructive">Reorder</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.code} · per {r.unit}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.qty}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.reorderLevel || '—'}</TableCell>
                    {canRequest && (
                      <TableCell className="text-right">
                        {on && (
                          <Input
                            className="ml-auto w-24"
                            type="number"
                            min={1}
                            aria-label={`Order qty for ${r.name}`}
                            value={picked[r.itemId]}
                            onChange={(e) => setPicked((p) => ({ ...p, [r.itemId]: Math.max(1, Number(e.target.value)) }))}
                          />
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  {!activeStore ? 'No stores yet. Create one under Pharmacy → Stores.' : stock.isPending ? 'Loading…' : 'Nothing to show.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
