'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Search } from 'lucide-react';
import { insurance as I } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PayerForm } from '@/modules/insurance/payer-form';
import { PAYER_TYPE_LABELS, Pager, SCHEME_LABELS, useDebounced } from '@/modules/insurance/ui';

export default function PayersPage() {
  const canRead = usePermission('insurance.payer.read');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [type, setType] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [adding, setAdding] = React.useState(false);
  const q = useDebounced(search.trim());
  const query: I.PayerQuery = { q: q || undefined, type: (type || undefined) as I.PayerType | undefined, active: 'all', page, pageSize: 50 };
  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ['insurance', 'payers', query],
    queryFn: () => api.insurance.payers.list(query),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });
  const create = useMutation({
    mutationFn: (body: I.PayerInput) => api.insurance.payers.create(body),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: ['insurance', 'payers'] });
      router.push(`/insurance/payers/${p.id}`);
    },
  });

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Payers & schemes"
        description="Insurers, TPAs, corporates and government schemes (PM-JAY, CGHS, ECHS, ESIC) the hospital bills."
        actions={
          <Can permission="insurance.payer.manage">
            <Button onClick={() => setAdding((a) => !a)}>
              <Plus /> Add payer
            </Button>
          </Can>
        }
      />
      {adding && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>New payer</CardTitle>
          </CardHeader>
          <CardContent>
            <PayerForm onSubmit={(b) => create.mutate(b)} pending={create.isPending} error={create.error ? errorMessage(create.error) : null} />
          </CardContent>
        </Card>
      )}
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" placeholder="Search name or code…" className="pl-9" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
          </div>
          <Select className="w-44" value={type} aria-label="Type" onChange={(e) => (setType(e.target.value), setPage(1))}>
            <option value="">All types</option>
            {I.PAYER_TYPES.map((t) => (
              <option key={t} value={t}>
                {PAYER_TYPE_LABELS[t]}
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
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Credit days</TableHead>
                <TableHead className="text-right">TDS</TableHead>
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
              ) : data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No payers yet. Add the insurers, TPAs and schemes you have tie-ups with.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => router.push(`/insurance/payers/${p.id}`)}>
                    <TableCell className="font-mono text-xs">{p.code}</TableCell>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.type === 'government' && p.scheme ? SCHEME_LABELS[p.scheme] : PAYER_TYPE_LABELS[p.type]}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.creditDays}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.tdsPercent}%</TableCell>
                    <TableCell>{p.isActive ? <Badge>Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
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
