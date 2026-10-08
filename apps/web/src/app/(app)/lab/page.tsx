'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Plus, ScanBarcode } from 'lucide-react';
import type { lab as L } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebounced } from '@/modules/billing/ui';
import { PaymentStateBadge } from '@/modules/billing/collect-now';
import { OrderStatusBadge, PriorityBadge, SOURCE_LABELS, ageFromDob, genderShort } from '@/modules/lab/ui';

const PAGE_SIZE = 25;
const FILTERS: { value: string; label: string }[] = [
  { value: 'open', label: 'Open (not reported)' },
  { value: 'ordered', label: 'Awaiting sample' },
  { value: 'collected', label: 'Ready for results' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Reported' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: '', label: 'All' },
];

export default function LabOrdersPage() {
  const canRead = usePermission('lab.order.read');
  const router = useRouter();
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('open');
  const [page, setPage] = React.useState(1);
  const q = useDebounced(search.trim());

  const query: L.OrderQuery = { q: q || undefined, status: (status || undefined) as L.OrderQuery['status'], page, pageSize: PAGE_SIZE };
  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ['lab', 'orders', query],
    queryFn: () => api.lab.orders.list(query),
    placeholderData: keepPreviousData,
    enabled: canRead,
    refetchInterval: 30_000,
  });

  if (!canRead) return <NoAccess />;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <PageHeader
        title="Lab orders"
        description="Every lab order from the counter and from OPD consultations. Scan a sample barcode or search by patient, UHID or order number."
        actions={
          <Can permission="lab.order.create">
            <Link href="/lab/new" className={buttonVariants()}>
              <Plus /> New lab order
            </Link>
          </Can>
        }
      />
      <Card>
        <form
          className="flex flex-wrap items-center gap-3 border-b p-4"
          onSubmit={(e) => {
            e.preventDefault();
            // A scanned barcode or order number that matches exactly one order opens it.
            if (data?.items.length === 1) router.push(`/lab/orders/${data.items[0]!.id}`);
          }}
        >
          <div className="relative w-full max-w-sm">
            <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              autoFocus
              placeholder="Scan barcode, or search name / UHID / order no…"
              className="pl-9"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            className="w-52"
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
          {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </form>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Order</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Tests</TableHead>
                <TableHead>Referred by</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Bill</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No lab orders here.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((o) => (
                  <TableRow key={o.id} className="cursor-pointer" onClick={() => router.push(`/lab/orders/${o.id}`)}>
                    <TableCell>
                      <Link href={`/lab/orders/${o.id}`} className="font-mono text-xs font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        {o.orderNo}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(o.createdAt)} · {SOURCE_LABELS[o.source]}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{o.patient.name}</div>
                      <div className="text-xs text-muted-foreground">
                        <span className="font-mono">{o.patient.uhid}</span> · {ageFromDob(o.patient.dateOfBirth)} {genderShort(o.patient.gender)}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <span className="line-clamp-2 text-sm">{o.itemNames.join(', ')}</span>
                    </TableCell>
                    <TableCell className="text-sm">{o.doctorName ?? o.referredBy ?? '—'}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        <OrderStatusBadge status={o.status} />
                        <PriorityBadge priority={o.priority} />
                        {o.hasCritical && <AlertTriangle className="size-4 text-destructive" aria-label="Critical value" />}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {o.invoiceNo ?? (o.paymentState === 'none' ? <span className="text-muted-foreground">Not billed</span> : null)}{' '}
                      <PaymentStateBadge state={o.paymentState} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-end gap-2 border-t p-3 text-sm">
            <span className="text-muted-foreground">
              Page {page} of {pages}
            </span>
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page">
              <ChevronRight />
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
