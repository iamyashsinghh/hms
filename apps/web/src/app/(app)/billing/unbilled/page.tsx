'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2, Plus, Search } from 'lucide-react';
import type { billing as B } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BillsTabs } from '@/modules/billing/tabs';
import { ACCOUNT_LABELS, formatDateTime, formatINR, useDebounced } from '@/modules/billing/ui';

const PAGE_SIZE = 50;

/** Every patient with charges still waiting for a bill, oldest first, so nothing is forgotten at day end. */
export default function UnbilledPage() {
  const canRead = usePermission('billing.invoice.read');
  const canBill = usePermission('billing.invoice.create');
  const router = useRouter();
  const [search, setSearch] = React.useState('');
  const [account, setAccount] = React.useState<B.ChargeAccount | ''>('');
  const [page, setPage] = React.useState(1);
  const q = useDebounced(search.trim());

  const query: B.UnbilledQuery = { q: q || undefined, account: account || undefined, page, pageSize: PAGE_SIZE };
  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ['billing', 'unbilled', query],
    queryFn: () => api.billing.charges.unbilled(query),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });

  if (!canRead) return <NoAccess />;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const open = (u: B.UnbilledPatient) => canBill && router.push(`/billing/new?patientId=${u.patientId}`);

  return (
    <>
      <PageHeader
        title="Bills"
        description="Patients with charges that are not on a bill yet, oldest first."
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
              placeholder="Patient name, UHID or mobile…"
              className="pl-9"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            className="w-40"
            value={account}
            aria-label="Visit type"
            onChange={(e) => {
              setAccount(e.target.value as B.ChargeAccount | '');
              setPage(1);
            }}
          >
            <option value="">OPD, IPD and other</option>
            <option value="opd">OPD</option>
            <option value="ipd">IPD</option>
            <option value="other">Other</option>
          </Select>
          {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>

        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Patient</TableHead>
                <TableHead>Visit</TableHead>
                <TableHead>Waiting since</TableHead>
                <TableHead className="text-right">Charges</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead />
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
                    {q || account ? 'No unbilled patients match.' : 'Everything is billed.'}
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((u) => (
                  <TableRow key={u.patientId} className={canBill ? 'cursor-pointer' : undefined} onClick={() => open(u)}>
                    <TableCell>
                      <span className="font-medium">{u.patientName}</span> <span className="font-mono text-xs text-muted-foreground">{u.uhid}</span>
                      {u.mobile && <span className="block text-xs text-muted-foreground">{u.mobile}</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {u.accounts.map((a) => (
                          <Badge key={a} variant={a === 'ipd' ? 'default' : 'outline'}>
                            {ACCOUNT_LABELS[a]}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>{formatDateTime(u.oldestChargeAt)}</TableCell>
                    <TableCell className="text-right tabular-nums">{u.pendingCount}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatINR(u.pendingTotal)}</TableCell>
                    <TableCell className="text-right">
                      {canBill && (
                        <Link href={`/billing/new?patientId=${u.patientId}`} className={buttonVariants({ variant: 'outline', size: 'sm' })} onClick={(e) => e.stopPropagation()}>
                          Bill
                        </Link>
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
