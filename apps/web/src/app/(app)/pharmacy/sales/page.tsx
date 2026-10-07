'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2, Plus, Search } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { inr } from '@/modules/pharmacy/format';

const PAGE_SIZE = 25;
const todayIso = () => new Date().toLocaleDateString('en-CA');

export default function SalesPage() {
  const canRead = usePermission('pharmacy.sale.read');
  const router = useRouter();
  const [search, setSearch] = React.useState('');
  const [q, setQ] = React.useState('');
  const [type, setType] = React.useState<'' | 'otc' | 'rx'>('');
  const [from, setFrom] = React.useState(todayIso);
  const [to, setTo] = React.useState(todayIso);
  const [page, setPage] = React.useState(1);
  React.useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ['pharmacy', 'sales', { q, type, from, to, page }],
    queryFn: () => api.pharmacy.sales.list({ q: q || undefined, type: type || undefined, from: from || undefined, to: to || undefined, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });
  if (!canRead) return <NoAccess />;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const pageTotal = data?.items.reduce((s, x) => s + x.total - x.returnedAmount, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Pharmacy sales"
        description={data ? `Net of returns on this page: ${inr(pageTotal)}` : undefined}
        actions={
          <Can permission="pharmacy.sale.create">
            <Link href="/pharmacy/sales/new" className={buttonVariants()}>
              <Plus /> New sale
            </Link>
          </Can>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" placeholder="Bill no., name or mobile…" className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Select aria-label="Type" className="w-32" value={type} onChange={(e) => { setType(e.target.value as typeof type); setPage(1); }}>
            <option value="">All</option>
            <option value="otc">OTC</option>
            <option value="rx">Rx</option>
          </Select>
          <Input aria-label="From" type="date" className="w-40" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          <Input aria-label="To" type="date" className="w-40" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Bill</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Loading…</TableCell>
                </TableRow>
              ) : data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">No sales in this period.</TableCell>
                </TableRow>
              ) : (
                data.items.map((s) => (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => router.push(`/pharmacy/sales/${s.id}`)}>
                    <TableCell className="font-mono text-xs">{s.number}</TableCell>
                    <TableCell>{new Date(s.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</TableCell>
                    <TableCell>
                      <Badge variant={s.type === 'rx' ? 'default' : 'secondary'}>{s.type.toUpperCase()}</Badge>
                    </TableCell>
                    <TableCell>{s.customerName ?? (s.patientId ? 'Registered patient' : 'Walk-in')}</TableCell>
                    <TableCell className="uppercase">{s.paymentMode ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{inr(s.total)}</TableCell>
                    <TableCell>
                      {s.status === 'completed' ? (
                        <Badge variant="secondary">Paid</Badge>
                      ) : (
                        <Badge variant="destructive">{s.status === 'returned' ? 'Returned' : `Returned ${inr(s.returnedAmount)}`}</Badge>
                      )}
                    </TableCell>
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
              <span>Page {page} of {pages}</span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
