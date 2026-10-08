'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Search } from 'lucide-react';
import { crm as C } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS, LeadStatusBadge, Pager, Select, formatDateTime, useDebounced } from '@/modules/crm/ui';
import { LeadForm } from '@/modules/crm/lead-form';

const PAGE_SIZE = 25;

export default function LeadsPage() {
  return (
    <React.Suspense>
      <Leads />
    </React.Suspense>
  );
}

function Leads() {
  const canRead = usePermission('crm.lead.read');
  const canManage = usePermission('crm.lead.manage');
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState(params.get('status') ?? 'open');
  const [source, setSource] = React.useState('');
  const [due, setDue] = React.useState(params.get('due') === 'true');
  const [page, setPage] = React.useState(1);
  const [adding, setAdding] = React.useState(false);
  const q = useDebounced(search.trim());

  const query: C.LeadQuery = {
    q: q || undefined,
    status: (status || undefined) as C.LeadQuery['status'],
    source: (source || undefined) as C.LeadSource | undefined,
    due: due ? 'true' : undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ['crm', 'leads', query],
    queryFn: () => api.crm.leads.list(query),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });

  const save = useMutation({
    mutationFn: (body: C.LeadInput) => api.crm.leads.create(body),
    onSuccess: (lead) => {
      setAdding(false);
      queryClient.invalidateQueries({ queryKey: ['crm'] });
      router.push(`/crm/leads/${lead.id}`);
    },
  });

  if (!canRead) return <NoAccess />;

  const reset = () => setPage(1);

  return (
    <>
      <PageHeader
        title="Enquiries"
        description="Every call, walk-in, camp visitor and website enquiry, until they become a patient."
        actions={
          <Can permission="crm.lead.manage">
            <Button onClick={() => setAdding(true)}>
              <Plus /> New enquiry
            </Button>
          </Can>
        }
      />

      {adding && canManage && <LeadForm saving={save.isPending} error={save.error} onCancel={() => setAdding(false)} onSave={(b) => save.mutate(b)} />}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Name, mobile or LD number…"
              className="pl-9"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                reset();
              }}
            />
          </div>
          <Select
            aria-label="Status"
            className="w-40"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              reset();
            }}
          >
            <option value="open">Open</option>
            <option value="">All</option>
            {C.LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Source"
            className="w-40"
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              reset();
            }}
          >
            <option value="">Any source</option>
            {C.LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {LEAD_SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={due}
              onChange={(e) => {
                setDue(e.target.checked);
                reset();
              }}
            />
            Calls due now
          </label>
          {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>

        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>No.</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>Looking for</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Next call</TableHead>
                <TableHead>Added</TableHead>
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
                    No enquiries found.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((l) => {
                  const overdue = l.nextFollowUpAt && new Date(l.nextFollowUpAt) <= new Date() && ['new', 'contacted', 'qualified'].includes(l.status);
                  return (
                    <TableRow key={l.id} className="cursor-pointer" onClick={() => router.push(`/crm/leads/${l.id}`)}>
                      <TableCell className="font-mono text-xs">{l.number}</TableCell>
                      <TableCell>
                        <Link href={`/crm/leads/${l.id}`} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                          {l.name}
                        </Link>
                        {l.referrerName && <div className="text-xs text-muted-foreground">via {l.referrerName}</div>}
                      </TableCell>
                      <TableCell>{l.mobile ?? l.email ?? '—'}</TableCell>
                      <TableCell className="max-w-48 truncate">{l.interest ?? '—'}</TableCell>
                      <TableCell>
                        {LEAD_SOURCE_LABELS[l.source]}
                        {l.campName && <div className="text-xs text-muted-foreground">{l.campName}</div>}
                      </TableCell>
                      <TableCell>
                        <LeadStatusBadge status={l.status} />
                      </TableCell>
                      <TableCell>{overdue ? <Badge variant="destructive">{formatDateTime(l.nextFollowUpAt)}</Badge> : formatDateTime(l.nextFollowUpAt)}</TableCell>
                      <TableCell>{formatDate(l.createdAt)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        )}
        <Pager data={data} page={page} setPage={setPage} />
      </Card>
    </>
  );
}
