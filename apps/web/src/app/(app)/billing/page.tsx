'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2, Plus, Search } from 'lucide-react';
import type { billing as B } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BillsTabs } from '@/modules/billing/tabs';
import { InvoiceStatusBadge, formatINR, useDebounced } from '@/modules/billing/ui';

const PAGE_SIZE = 25;

export default function Page() {
  return (
    <React.Suspense>
      <BillsPage />
    </React.Suspense>
  );
}

function BillsPage() {
  const canRead = usePermission('billing.invoice.read');
  const router = useRouter();
  // ?q= opens the list already searched (e.g. "earlier bills due" on the billing desk).
  const params = useSearchParams();
  const [search, setSearch] = React.useState(() => params.get('q') ?? '');
  const [filter, setFilter] = React.useState('');
  const [page, setPage] = React.useState(1);
  const q = useDebounced(search.trim());

  const query: B.InvoiceQuery = { q: q || undefined, page, pageSize: PAGE_SIZE };
  if (filter === 'draft' || filter === 'cancelled') query.status = filter;
  if (filter === 'unpaid' || filter === 'partial' || filter === 'paid') query.paymentStatus = filter;

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ['billing', 'invoices', query],
    queryFn: () => api.billing.invoices.list(query),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });

  if (!canRead) return <NoAccess />;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Bills"
        description="OPD, pharmacy and other bills. Search by bill number, patient name, UHID or mobile."
        actions={
          <Can permission="billing.invoice.create">
            <Link href="/billing/new" className={buttonVariants()}>
              <Plus /> Bill a patient
            </Link>
          </Can>
        }
      />
      <BillsTabs />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search bills…"
              className="pl-9"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            className="w-44"
            value={filter}
            aria-label="Filter"
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All bills</option>
            <option value="unpaid">Unpaid</option>
            <option value="partial">Part paid</option>
            <option value="paid">Paid</option>
            <option value="draft">Drafts</option>
            <option value="cancelled">Cancelled</option>
          </Select>
          {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>

        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Bill no.</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No bills found.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((inv) => (
                  <TableRow key={inv.id} className="cursor-pointer" onClick={() => router.push(`/billing/invoices/${inv.id}`)}>
                    <TableCell className="font-mono text-xs">{inv.number ?? 'Draft'}</TableCell>
                    <TableCell>{formatDate(inv.invoiceDate)}</TableCell>
                    <TableCell>
                      <span className="font-medium">{inv.patientName}</span> <span className="font-mono text-xs text-muted-foreground">{inv.patientUhid}</span>
                    </TableCell>
                    <TableCell className="capitalize">{inv.sourceModule}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(inv.total)}</TableCell>
                    <TableCell className="text-right tabular-nums">{inv.status === 'final' ? formatINR(inv.balance) : '—'}</TableCell>
                    <TableCell>
                      <InvoiceStatusBadge inv={inv} />
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
    </>
  );
}
