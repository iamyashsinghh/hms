'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Loader2, Plus, Search } from 'lucide-react';
import { insurance as I } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pager, StatusBadge, formatINR, statusLabel, useDebounced } from '@/modules/insurance/ui';

export default function PreauthsPage() {
  const canRead = usePermission('insurance.preauth.read');
  const router = useRouter();
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const q = useDebounced(search.trim());
  const query: I.PreauthQuery = { q: q || undefined, status: (status || undefined) as I.PreauthStatus | undefined, page, pageSize: 25 };
  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ['insurance', 'preauths', query],
    queryFn: () => api.insurance.preauths.list(query),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Pre-authorisations"
        description="Cashless approval requests to insurers, TPAs and schemes before or during admission."
        actions={
          <Can permission="insurance.preauth.manage">
            <Link href="/insurance/preauths/new" className={buttonVariants()}>
              <Plus /> New pre-auth
            </Link>
          </Can>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" placeholder="Number, patient, UHID or payer ref…" className="pl-9" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
          </div>
          <Select className="w-44" value={status} aria-label="Status" onChange={(e) => (setStatus(e.target.value), setPage(1))}>
            <option value="">All statuses</option>
            {I.PREAUTH_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
          {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>No.</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Payer</TableHead>
                <TableHead>Diagnosis</TableHead>
                <TableHead className="text-right">Requested</TableHead>
                <TableHead className="text-right">Approved</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                    No pre-auths found.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => router.push(`/insurance/preauths/${p.id}`)}>
                    <TableCell className="font-mono text-xs">{p.number}</TableCell>
                    <TableCell>{formatDate(p.createdAt)}</TableCell>
                    <TableCell>
                      <span className="font-medium">{p.patientName}</span> <span className="font-mono text-xs text-muted-foreground">{p.patientUhid}</span>
                    </TableCell>
                    <TableCell>{p.payerName}</TableCell>
                    <TableCell className="max-w-56 truncate">{p.diagnosis}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(p.requestedAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(p.approvedAmount)}</TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
    </>
  );
}
