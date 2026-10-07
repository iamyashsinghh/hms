'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { quality as Q } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AddCapa } from '@/modules/quality/capa-form';
import { EnumSelect, Pager, StatusBadge, humanize } from '@/modules/quality/ui';

export default function CapaPage() {
  return (
    <React.Suspense>
      <CapaList />
    </React.Suspense>
  );
}

function CapaList() {
  const can = usePermission('quality.capa.read');
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState<Q.CapaStatus | ''>('');
  const [sourceType, setSourceType] = React.useState<Q.CapaSource | ''>('');
  const [overdue, setOverdue] = React.useState(params.get('overdue') === 'true');
  const [mine, setMine] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const query = {
    status: status || undefined,
    sourceType: sourceType || undefined,
    overdue: overdue ? ('true' as const) : undefined,
    mine: mine ? ('true' as const) : undefined,
    page,
    pageSize: 25,
  };
  const { data, isPending, error } = useQuery({
    queryKey: ['quality', 'capas', query],
    queryFn: () => api.quality.capas.list(query),
    placeholderData: keepPreviousData,
    enabled: can,
  });
  if (!can) return <NoAccess />;
  return (
    <>
      <PageHeader title="Corrective & preventive actions" description="Every action has an owner and a due date, and is verified for effectiveness before it closes." />
      <div className="space-y-6">
        <Card>
          <CardContent className="pt-6">
            <AddCapa sourceType="other" onCreated={(c) => (queryClient.invalidateQueries({ queryKey: ['quality'] }), router.push(`/quality/capa/${c.id}`))} />
          </CardContent>
        </Card>
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b p-4">
            <div className="w-40">
              <EnumSelect value={status} onChange={(v) => (setStatus(v), setPage(1))} options={Q.CAPA_STATUSES} placeholder="Any status" />
            </div>
            <div className="w-40">
              <EnumSelect value={sourceType} onChange={(v) => (setSourceType(v), setPage(1))} options={Q.CAPA_SOURCES} placeholder="Any source" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={overdue} onChange={(e) => (setOverdue(e.target.checked), setPage(1))} /> Overdue
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={mine} onChange={(e) => (setMine(e.target.checked), setPage(1))} /> Mine
            </label>
          </div>
          {error && <p className="px-4 pt-3 text-sm text-destructive">{errorMessage(error)}</p>}
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>No.</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : !data?.items.length ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No actions found.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/quality/capa/${c.id}`)}>
                    <TableCell className="font-mono text-xs">{c.capaNo}</TableCell>
                    <TableCell className="font-medium">{c.title}</TableCell>
                    <TableCell>{humanize(c.sourceType)}</TableCell>
                    <TableCell>{c.owner?.name ?? '—'}</TableCell>
                    <TableCell>{c.dueDate}</TableCell>
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
      </div>
    </>
  );
}
