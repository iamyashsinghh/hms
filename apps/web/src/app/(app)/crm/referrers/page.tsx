'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { crm as C } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pager, REFERRER_TYPE_LABELS, Select, formatINR, useDebounced } from '@/modules/crm/ui';
import { ReferrerForm } from './referrer-form';

export default function ReferrersPage() {
  const canRead = usePermission('crm.referrer.read');
  const canManage = usePermission('crm.referrer.manage');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [type, setType] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [adding, setAdding] = React.useState(false);
  const q = useDebounced(search.trim());

  const query: C.ReferrerQuery = { q: q || undefined, type: (type || undefined) as C.ReferrerType | undefined, page, pageSize: 25 };
  const { data, isPending, error } = useQuery({
    queryKey: ['crm', 'referrers', query],
    queryFn: () => api.crm.referrers.list(query),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });
  const create = useMutation({
    mutationFn: (body: C.ReferrerInput) => api.crm.referrers.create(body),
    onSuccess: (r) => {
      setAdding(false);
      queryClient.invalidateQueries({ queryKey: ['crm', 'referrers'] });
      router.push(`/crm/referrers/${r.id}`);
    },
  });

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Referrers"
        description="Doctors, clinics and agents who send patients. Their commission accrues automatically when the patient is billed."
        actions={
          <Can permission="crm.referrer.manage">
            <Button onClick={() => setAdding(true)}>
              <Plus /> Add referrer
            </Button>
          </Can>
        }
      />
      {adding && canManage && <ReferrerForm title="Add referrer" saving={create.isPending} error={create.error} onCancel={() => setAdding(false)} onSave={(b) => create.mutate(b)} />}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Name, code, mobile or clinic…"
              className="pl-9"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            aria-label="Type"
            className="w-40"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All types</option>
            {C.REFERRER_TYPES.map((t) => (
              <option key={t} value={t}>
                {REFERRER_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead className="text-right">Referrals</TableHead>
                <TableHead className="text-right">Accrued</TableHead>
                <TableHead className="text-right">Payable</TableHead>
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
                    No referrers yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(`/crm/referrers/${r.id}`)}>
                    <TableCell className="font-mono text-xs">{r.code}</TableCell>
                    <TableCell>
                      <Link href={`/crm/referrers/${r.id}`} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                        {r.name}
                      </Link>
                      {!r.isActive && <Badge variant="secondary" className="ml-2">Inactive</Badge>}
                      {r.organization && <div className="text-xs text-muted-foreground">{r.organization}</div>}
                    </TableCell>
                    <TableCell>{REFERRER_TYPE_LABELS[r.type]}</TableCell>
                    <TableCell>{r.mobile ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.referralCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(r.openCommission)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(r.payableCommission)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
        <Pager data={data} page={page} setPage={setPage} />
      </Card>
    </>
  );
}
