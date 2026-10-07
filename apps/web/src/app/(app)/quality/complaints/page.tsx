'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { quality as Q } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EnumSelect, Pager, StatusBadge, formatDateTime, humanize } from '@/modules/quality/ui';

export default function ComplaintsPage() {
  return (
    <React.Suspense>
      <Complaints />
    </React.Suspense>
  );
}

function Complaints() {
  const canRead = usePermission('quality.complaint.read');
  const canCreate = usePermission('quality.complaint.create');
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = React.useState<Q.ComplaintStatus | ''>('');
  const [category, setCategory] = React.useState<Q.ComplaintCategory | ''>('');
  const [overdue, setOverdue] = React.useState(params.get('overdue') === 'true');
  const [q, setQ] = React.useState('');
  const [page, setPage] = React.useState(1);
  const query = { status: status || undefined, category: category || undefined, overdue: overdue ? ('true' as const) : undefined, q: q.trim() || undefined, page, pageSize: 25 };
  const { data, isPending, error } = useQuery({
    queryKey: ['quality', 'complaints', query],
    queryFn: () => api.quality.complaints.list(query),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });

  if (!canRead && !canCreate) return <NoAccess />;
  const newButton = canCreate && (
    <Link href="/quality/complaints/new" className={buttonVariants()}>
      <Plus /> Register complaint
    </Link>
  );
  if (!canRead) {
    return (
      <>
        <PageHeader title="Patient complaints" actions={newButton} />
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">Register a complaint and the quality team will follow it up.</CardContent>
        </Card>
      </>
    );
  }
  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  return (
    <>
      <PageHeader title="Patient complaints" description="Every complaint has a resolution deadline: 24 h for high, 72 h for medium, 7 days for low priority." actions={newButton} />
      {error && <p className="mb-4 text-sm text-destructive">{errorMessage(error)}</p>}
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" className="pl-9" placeholder="CM number, name or mobile" value={q} onChange={(e) => reset(setQ)(e.target.value)} />
          </div>
          <div className="w-40">
            <EnumSelect value={status} onChange={reset(setStatus)} options={Q.COMPLAINT_STATUSES} placeholder="Any status" />
          </div>
          <div className="w-44">
            <EnumSelect value={category} onChange={reset(setCategory)} options={Q.COMPLAINT_CATEGORIES} placeholder="Any category" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={overdue} onChange={(e) => reset(setOverdue)(e.target.checked)} /> Overdue only
          </label>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>No.</TableHead>
              <TableHead>Received</TableHead>
              <TableHead>Complainant</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Due</TableHead>
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
            ) : !data?.items.length ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  No complaints found.
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/quality/complaints/${c.id}`)}>
                  <TableCell className="font-mono text-xs">{c.complaintNo}</TableCell>
                  <TableCell>{formatDateTime(c.createdAt)}</TableCell>
                  <TableCell>
                    {c.complainantName}
                    {c.patient && <div className="font-mono text-xs text-muted-foreground">{c.patient.uhid}</div>}
                  </TableCell>
                  <TableCell>{humanize(c.category)}</TableCell>
                  <TableCell>
                    <Badge variant={c.priority === 'high' ? 'destructive' : c.priority === 'medium' ? 'default' : 'secondary'}>{humanize(c.priority)}</Badge>
                  </TableCell>
                  <TableCell>{formatDateTime(c.dueAt)}</TableCell>
                  <TableCell>
                    <StatusBadge status={c.status} overdue={c.overdue} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <Pager data={data} page={page} setPage={setPage} />
      </Card>
    </>
  );
}
