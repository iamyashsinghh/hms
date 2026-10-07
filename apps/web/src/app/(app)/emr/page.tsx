'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Play, Plus, RefreshCw, Search } from 'lucide-react';
import type { emr } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { fullName, genderLabel } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge, ageFromDob, formatTime, todayIso } from '@/modules/emr/ui';

function NewConsultation() {
  const router = useRouter();
  const qc = useQueryClient();
  const [q, setQ] = React.useState('');
  const term = q.trim();
  const { data, isFetching } = useQuery({
    queryKey: ['patients', { q: term, page: 1 }],
    queryFn: () => api.patients.list({ q: term, pageSize: 6 }),
    enabled: term.length >= 2,
  });
  const open = useMutation({
    mutationFn: (patientId: string) => api.emr.open({ patientId }),
    onSuccess: (enc) => {
      qc.invalidateQueries({ queryKey: ['emr', 'queue'] });
      router.push(`/emr/encounters/${enc.id}`);
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Walk-in consultation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search patient by name, UHID or mobile" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        {open.error && <p className="text-sm text-destructive">{errorMessage(open.error)}</p>}
        {term.length >= 2 && data && (
          <ul className="divide-y rounded-md border">
            {data.items.length === 0 && <li className="p-3 text-sm text-muted-foreground">No patients found.</li>}
            {data.items.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                <div>
                  <div className="font-medium">{fullName(p)}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.uhid} · {genderLabel(p.gender)} · {p.mobile ?? 'no mobile'}
                  </div>
                </div>
                <Button size="sm" disabled={open.isPending} onClick={() => open.mutate(p.id)}>
                  <Plus /> Start
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function EmrQueuePage() {
  const canRead = usePermission('emr.encounter.read');
  const router = useRouter();
  const qc = useQueryClient();
  const [date, setDate] = React.useState(todayIso);
  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: ['emr', 'queue', date],
    queryFn: () => api.emr.queue({ date }),
    enabled: canRead,
    refetchInterval: 30_000,
  });
  const start = useMutation({
    mutationFn: (id: string) => api.emr.start(id),
    onSuccess: (enc) => {
      qc.invalidateQueries({ queryKey: ['emr', 'queue'] });
      router.push(`/emr/encounters/${enc.id}`);
    },
  });

  if (!canRead) return <NoAccess />;
  const items: emr.QueueItem[] = data?.items ?? [];
  const counts = {
    waiting: items.filter((i) => i.status === 'waiting').length,
    done: items.filter((i) => i.status === 'completed').length,
  };

  return (
    <>
      <PageHeader
        title="My OPD queue"
        description={`${items.length} patients · ${counts.waiting} waiting · ${counts.done} seen`}
        actions={
          <>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
            <Button variant="outline" onClick={() => refetch()} aria-label="Refresh">
              {isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            </Button>
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          {error ? (
            <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Token</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Age / Sex</TableHead>
                  <TableHead>Arrived</TableHead>
                  <TableHead>Status</TableHead>
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
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      No patients in the queue for this day.
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((i) => (
                    <TableRow key={i.encounterId}>
                      <TableCell className="font-mono">{i.tokenNo ?? '—'}</TableCell>
                      <TableCell>
                        <Link href={`/emr/encounters/${i.encounterId}`} className="font-medium text-primary hover:underline">
                          {i.patientName}
                        </Link>
                        <div className="text-xs text-muted-foreground">{i.uhid}</div>
                      </TableCell>
                      <TableCell>
                        {ageFromDob(i.dateOfBirth)} · {genderLabel(i.gender)}
                      </TableCell>
                      <TableCell>{formatTime(i.checkedInAt)}</TableCell>
                      <TableCell>
                        <StatusBadge status={i.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {i.status === 'waiting' ? (
                          <Can permission="emr.encounter.write">
                            <Button size="sm" disabled={start.isPending} onClick={() => start.mutate(i.encounterId)}>
                              <Play /> Call in
                            </Button>
                          </Can>
                        ) : (
                          <Link href={`/emr/encounters/${i.encounterId}`} className="text-sm text-primary hover:underline">
                            Open
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
          {start.error && <p className="px-6 pb-4 text-sm text-destructive">{errorMessage(start.error)}</p>}
        </Card>
        <Can permission="emr.encounter.write">
          <NewConsultation />
        </Can>
      </div>
    </>
  );
}
