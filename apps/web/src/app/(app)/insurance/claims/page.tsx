'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { Pager, StatusBadge, formatINR, statusLabel, todayIST, useDebounced } from '@/modules/insurance/ui';

export default function Page() {
  return (
    <React.Suspense>
      <ClaimsPage />
    </React.Suspense>
  );
}

function ClaimsPage() {
  const canRead = usePermission('insurance.claim.read');
  const router = useRouter();
  const params = useSearchParams();
  const payerId = params.get('payerId') ?? undefined;
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState(params.get('status') ?? (params.get('open') === 'true' ? 'open' : ''));
  const [page, setPage] = React.useState(1);
  const q = useDebounced(search.trim());
  const query: I.ClaimQuery = { q: q || undefined, payerId, page, pageSize: 25 };
  if (filter === 'open') query.open = 'true';
  else if (filter) query.status = filter as I.ClaimStatus;
  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ['insurance', 'claims', query],
    queryFn: () => api.insurance.claims.list(query),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });
  const today = todayIST();

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Claims"
        description="Cashless and corporate credit claims: preparation, submission, queries and settlement."
        actions={
          <Can permission="insurance.claim.manage">
            <Link href="/insurance/claims/new" className={buttonVariants()}>
              <Plus /> New claim
            </Link>
          </Can>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" placeholder="Claim no., patient, UHID or payer claim no.…" className="pl-9" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
          </div>
          <Select className="w-48" value={filter} aria-label="Status" onChange={(e) => (setFilter(e.target.value), setPage(1))}>
            <option value="">All claims</option>
            <option value="open">Open (payer owes)</option>
            {I.CLAIM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
          {payerId && (
            <Link href="/insurance/claims" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              Clear payer filter
            </Link>
          )}
          {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Claim</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Payer</TableHead>
                <TableHead className="text-right">Claimed</TableHead>
                <TableHead className="text-right">Settled</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead>Due</TableHead>
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
                    No claims found.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/insurance/claims/${c.id}`)}>
                    <TableCell>
                      <span className="font-mono text-xs">{c.number}</span>
                      <div className="text-xs capitalize text-muted-foreground">{c.claimType}</div>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{c.patientName}</span> <span className="font-mono text-xs text-muted-foreground">{c.patientUhid}</span>
                    </TableCell>
                    <TableCell>{c.payerName}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(c.claimedAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(c.settledAmount + c.tdsAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.outstanding ? formatINR(c.outstanding) : '—'}</TableCell>
                    <TableCell className={c.outstanding && c.dueDate && c.dueDate < today ? 'text-destructive' : ''}>{c.dueDate ? formatDate(c.dueDate) : '—'}</TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
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
