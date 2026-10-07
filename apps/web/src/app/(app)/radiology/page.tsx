'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2, Plus, Search } from 'lucide-react';
import type { radiology } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { OrderStatusBadge, PriorityBadge, dateTime, patientLine, todayIso } from '@/modules/radiology/ui';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 50;

/** Worklist tabs: each maps to a set of order statuses. */
const TABS: { key: string; label: string; statuses?: radiology.OrderStatus[] }[] = [
  { key: 'pending', label: 'To scan', statuses: ['ordered', 'scheduled', 'in_progress'] },
  { key: 'reporting', label: 'To report', statuses: ['acquired', 'reported'] },
  { key: 'done', label: 'Reports ready', statuses: ['finalized'] },
  { key: 'all', label: 'All' },
];

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function RadiologyWorklistPage() {
  const canRead = usePermission('radiology.order.read');
  const router = useRouter();
  const [tab, setTab] = React.useState('pending');
  const [date, setDate] = React.useState(todayIso);
  const [modalityId, setModalityId] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const q = useDebounced(search.trim());
  const statuses = TABS.find((t) => t.key === tab)?.statuses?.join(',');

  const modalities = useQuery({ queryKey: ['radiology', 'modalities'], queryFn: () => api.radiology.modalities(), enabled: canRead });
  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ['radiology', 'orders', { statuses, date, modalityId, q, page }],
    queryFn: () =>
      api.radiology.orders({
        statuses,
        // A search looks across all days.
        date: q ? undefined : date || undefined,
        modalityId: modalityId || undefined,
        q: q || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
    enabled: canRead,
    refetchInterval: 30_000,
  });

  if (!canRead) return <NoAccess />;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Radiology worklist"
        description="X-ray, ultrasound, CT and MRI orders from doctors and the desk. Urgent studies come first."
        actions={
          <Can permission="radiology.order.create">
            <Link href="/radiology/new" className={buttonVariants()}>
              <Plus /> New order
            </Link>
          </Can>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              setPage(1);
            }}
            className={cn(buttonVariants({ variant: tab === t.key ? 'default' : 'outline', size: 'sm' }))}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Order no, UHID, name, mobile, study…"
              className="pl-9"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Input type="date" className="w-40" value={date} disabled={!!q} onChange={(e) => setDate(e.target.value)} aria-label="Day" />
          <Select className="w-48" value={modalityId} onChange={(e) => setModalityId(e.target.value)} aria-label="Machine">
            <option value="">All machines</option>
            {modalities.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>

        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : isPending ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : data.items.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No radiology orders here.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Study</TableHead>
                <TableHead>Referred by</TableHead>
                <TableHead>Slot</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((o) => (
                <TableRow key={o.id} className="cursor-pointer" onClick={() => router.push(`/radiology/orders/${o.id}`)}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/radiology/orders/${o.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                      {o.orderNo}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{o.patient.name}</div>
                    <div className="text-xs text-muted-foreground">{patientLine(o.patient)}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {o.studyName} <PriorityBadge priority={o.priority} />
                    </div>
                    <div className="text-xs text-muted-foreground">{o.modalityName ?? 'Test not picked yet'}</div>
                  </TableCell>
                  <TableCell className="text-sm">{o.referringDoctorName ?? '—'}</TableCell>
                  <TableCell className="text-sm">{dateTime(o.scheduledAt)}</TableCell>
                  <TableCell>
                    <OrderStatusBadge status={o.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-end gap-2 border-t p-3 text-sm">
            <span className="text-muted-foreground">
              Page {page} of {pages}
            </span>
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
              <ChevronRight />
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
