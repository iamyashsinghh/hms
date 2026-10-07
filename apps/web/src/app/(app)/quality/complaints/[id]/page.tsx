'use client';

import * as React from 'react';
import Link from 'next/link';
import { use } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { quality as Q } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AddCapa } from '@/modules/quality/capa-form';
import { ActivityList, CapaList, EnumSelect, ErrorBox, Field, StaffSelect, StatusBadge, Textarea, formatDateTime, humanize } from '@/modules/quality/ui';

export default function ComplaintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = usePermission('quality.complaint.read');
  const canManage = usePermission('quality.complaint.manage');
  const queryClient = useQueryClient();
  const key = ['quality', 'complaints', id];
  const { data: c, isPending, error } = useQuery({ queryKey: key, queryFn: () => api.quality.complaints.get(id), enabled: can });

  if (!can) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  const refresh = (next?: Q.Complaint) => {
    if (next) queryClient.setQueryData(key, next);
    else queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ['quality'], refetchType: 'none' });
  };

  return (
    <div className="space-y-6">
      <Link href="/quality/complaints" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
        <ArrowLeft /> All complaints
      </Link>
      <div>
        <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
          Complaint {c.complaintNo} <StatusBadge status={c.status} overdue={c.overdue} />
          {c.withinTat === true && <Badge variant="accent">Within TAT</Badge>}
          {c.withinTat === false && <Badge variant="destructive">Missed TAT</Badge>}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {humanize(c.category)} · {humanize(c.priority)} priority · via {humanize(c.source)} · received {formatDateTime(c.createdAt)} · due {formatDateTime(c.dueAt)}
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{c.complainantName}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                {c.complainantMobile ?? 'No mobile'} {c.patient && `· Patient ${c.patient.name} (${c.patient.uhid})`} {c.department && `· ${c.department}`}
              </p>
              <p className="whitespace-pre-wrap">{c.description}</p>
              {c.resolution && (
                <div>
                  <div className="font-medium">Resolution</div>
                  <p className="whitespace-pre-wrap text-muted-foreground">{c.resolution}</p>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Corrective and preventive actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <CapaList items={c.capas} />
              {c.status !== 'closed' && <AddCapa sourceType="complaint" sourceId={c.id} defaultProblem={c.description} onCreated={() => refresh()} />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityList items={c.activity} />
            </CardContent>
          </Card>
        </div>
        {canManage && c.status !== 'closed' && <ManagePanel c={c} onSaved={refresh} />}
      </div>
    </div>
  );
}

function ManagePanel({ c, onSaved }: { c: Q.Complaint; onSaved: (c: Q.Complaint) => void }) {
  const [status, setStatus] = React.useState<Q.ComplaintStatus | ''>(c.status);
  const [assignedTo, setAssignedTo] = React.useState(c.assignedTo?.id ?? '');
  const [priority, setPriority] = React.useState<Q.ComplaintPriority | ''>(c.priority);
  const [resolution, setResolution] = React.useState('');
  const [note, setNote] = React.useState('');
  const save = useMutation({
    mutationFn: () =>
      api.quality.complaints.update(c.id, {
        status: status && status !== c.status ? status : undefined,
        assignedTo: assignedTo || null,
        priority: priority || undefined,
        resolution: resolution || undefined,
        note: note || undefined,
      }),
    onSuccess: (next) => {
      setNote('');
      setResolution('');
      setStatus(next.status);
      onSaved(next);
    },
  });
  const options = [c.status, ...Q.COMPLAINT_TRANSITIONS[c.status]];
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Follow up</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <ErrorBox error={save.error} />
          <Field id="status" label="Status">
            <EnumSelect id="status" value={status} onChange={setStatus} options={options} />
          </Field>
          <Field id="assignedTo" label="Assigned to">
            <StaffSelect id="assignedTo" value={assignedTo} onChange={setAssignedTo} />
          </Field>
          <Field id="priority" label="Priority" hint="Changing priority moves the due time.">
            <EnumSelect id="priority" value={priority} onChange={setPriority} options={Q.COMPLAINT_PRIORITIES} />
          </Field>
          {status === 'resolved' && status !== c.status && (
            <Field id="resolution" label="How was it resolved? *">
              <Textarea id="resolution" required value={resolution} onChange={(e) => setResolution(e.target.value)} />
            </Field>
          )}
          <Field id="note" label={c.status === 'resolved' && status === 'in_progress' ? 'Why reopen? *' : 'Note'}>
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full" disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />} Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
