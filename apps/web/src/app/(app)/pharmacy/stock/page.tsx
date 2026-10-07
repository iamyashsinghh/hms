'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2, PackagePlus, Search } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SCHEDULE_LABEL, expiryLabel } from '@/modules/pharmacy/format';
import { StorePicker, useActiveStore } from '@/modules/pharmacy/use-store';
import { BatchesDialog } from '@/modules/pharmacy/batches-dialog';

const PAGE_SIZE = 25;

export default function PharmacyStockPage() {
  const canRead = usePermission('pharmacy.stock.read');
  const active = useActiveStore();
  const storeId = active.store?.id;
  const [search, setSearch] = React.useState('');
  const [q, setQ] = React.useState('');
  const [lowOnly, setLowOnly] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [batchesOf, setBatchesOf] = React.useState<{ id: string; name: string } | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ['pharmacy', 'stock', { storeId, q, lowOnly, page }],
    queryFn: () => api.pharmacy.stock.list({ storeId: storeId!, q: q || undefined, lowOnly, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
    enabled: canRead && !!storeId,
  });

  if (!canRead) return <NoAccess />;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Pharmacy stock"
        description="Sellable units per drug in the selected store. Expired units are shown separately and never sold."
        actions={
          <>
            <StorePicker active={active} />
            <Can permission="pharmacy.stock.receive">
              <Link href="/pharmacy/receive" className={buttonVariants()}>
                <PackagePlus /> Receive stock
              </Link>
            </Can>
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search by name, generic or code…"
              className="pl-9"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={lowOnly}
              onChange={(e) => {
                setLowOnly(e.target.checked);
                setPage(1);
              }}
            />
            Only low stock
          </label>
          {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Code</TableHead>
                <TableHead>Drug</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead className="text-right">In stock</TableHead>
                <TableHead className="text-right">Reorder at</TableHead>
                <TableHead>Nearest expiry</TableHead>
                <TableHead className="text-right">Expired</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!storeId || isPending ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    {storeId ? 'Loading…' : 'Pick a store.'}
                  </TableCell>
                </TableRow>
              ) : data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No drugs found. Add drugs in the drug master, then receive stock.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((r) => (
                  <TableRow key={r.itemId} className="cursor-pointer" onClick={() => setBatchesOf({ id: r.itemId, name: r.name })}>
                    <TableCell className="font-mono text-xs">{r.code}</TableCell>
                    <TableCell>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{[r.genericName, r.strength, r.form].filter(Boolean).join(' · ')}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.schedule === 'otc' ? 'secondary' : 'accent'}>{SCHEDULE_LABEL[r.schedule] ?? r.schedule}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.isLow ? <Badge variant="destructive">{r.qty}</Badge> : r.qty} <span className="text-xs text-muted-foreground">{r.unit}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.reorderLevel || '—'}</TableCell>
                    <TableCell>{r.nearestExpiry ? expiryLabel(r.nearestExpiry) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.expiredQty ? <span className="text-destructive">{r.expiredQty}</span> : '—'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
        {data && data.total > 0 && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
            <span>
              {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft /> Prev
              </Button>
              <span>
                Page {page} of {pages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </Card>
      {batchesOf && storeId && <BatchesDialog storeId={storeId} item={batchesOf} onClose={() => setBatchesOf(null)} />}
    </>
  );
}
