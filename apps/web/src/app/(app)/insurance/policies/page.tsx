'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Search } from 'lucide-react';
import type { insurance as I } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PolicyForm } from '@/modules/insurance/policy-form';
import { Pager, coverText, formatINR, useDebounced } from '@/modules/insurance/ui';

export default function PoliciesPage() {
  const canRead = usePermission('insurance.policy.read');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [active, setActive] = React.useState<'true' | 'false' | 'all'>('true');
  const [page, setPage] = React.useState(1);
  const [adding, setAdding] = React.useState(false);
  const q = useDebounced(search.trim());
  const query: I.PolicyQuery = { q: q || undefined, active, page, pageSize: 25 };
  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ['insurance', 'policies', query],
    queryFn: () => api.insurance.policies.list(query),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });
  const create = useMutation({
    mutationFn: (body: I.PolicyInput) => api.insurance.policies.create(body),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: ['insurance', 'policies'] });
      router.push(`/insurance/policies/${p.id}`);
    },
  });

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Patient policies"
        description="Health insurance, corporate cover and scheme cards on file. Search by patient, UHID, policy or card number."
        actions={
          <Can permission="insurance.policy.manage">
            <Button onClick={() => setAdding((a) => !a)}>
              <Plus /> Add policy
            </Button>
          </Can>
        }
      />
      {adding && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>New policy</CardTitle>
          </CardHeader>
          <CardContent>
            <PolicyForm onSubmit={(b) => create.mutate(b)} pending={create.isPending} error={create.error ? errorMessage(create.error) : null} />
          </CardContent>
        </Card>
      )}
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" placeholder="Search policies…" className="pl-9" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
          </div>
          <Select className="w-40" value={active} aria-label="Status" onChange={(e) => (setActive(e.target.value as typeof active), setPage(1))}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
            <option value="all">All</option>
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
                <TableHead>Payer</TableHead>
                <TableHead>Policy / card</TableHead>
                <TableHead>Cover</TableHead>
                <TableHead className="text-right">Sum insured left</TableHead>
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
                    No policies found.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => router.push(`/insurance/policies/${p.id}`)}>
                    <TableCell>
                      <span className="font-medium">{p.patientName}</span> <span className="font-mono text-xs text-muted-foreground">{p.patientUhid}</span>
                    </TableCell>
                    <TableCell>
                      {p.payerName}
                      {p.tpaName && <div className="text-xs text-muted-foreground">via {p.tpaName}</div>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {p.policyNumber}
                      {p.memberId && <div className="text-muted-foreground">{p.memberId}</div>}
                    </TableCell>
                    <TableCell className="text-sm">{coverText(p)}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.balanceSumInsured != null ? formatINR(p.balanceSumInsured) : '—'}</TableCell>
                    <TableCell>{p.verifiedAt ? <Badge>Verified</Badge> : !p.isActive ? <Badge variant="outline">Inactive</Badge> : null}</TableCell>
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
