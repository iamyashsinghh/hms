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
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AddCapa } from '@/modules/quality/capa-form';
import {
  ActivityList,
  CATEGORY_LABELS,
  CapaList,
  ErrorBox,
  Field,
  SeverityBadge,
  StaffSelect,
  StatusBadge,
  Textarea,
  formatDateTime,
  humanize,
} from '@/modules/quality/ui';

export default function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = usePermission('quality.incident.report');
  const canManage = usePermission('quality.incident.manage');
  const queryClient = useQueryClient();
  const key = ['quality', 'incidents', id];
  const { data: inc, isPending, error } = useQuery({ queryKey: key, queryFn: () => api.quality.incidents.get(id), enabled: can });

  if (!can) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;

  const refresh = (next?: Q.Incident) => {
    if (next) queryClient.setQueryData(key, next);
    else queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ['quality'], refetchType: 'none' });
  };
  const open = inc.status !== 'closed' && inc.status !== 'rejected';

  return (
    <div className="space-y-6">
      <Link href={canManage ? '/quality/incidents' : '/quality/incidents/mine'} className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
        <ArrowLeft /> Back
      </Link>
      <div>
        <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
          Incident {inc.incidentNo} <StatusBadge status={inc.status} /> <SeverityBadge severity={inc.severity} />
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {CATEGORY_LABELS[inc.category]} · {humanize(inc.kind)} · occurred {formatDateTime(inc.occurredAt)} · reported {formatDateTime(inc.reportedAt)} by{' '}
          {inc.isAnonymous ? 'an anonymous reporter' : (inc.reportedBy?.name ?? '—')}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>What happened</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <dl className="grid gap-3 sm:grid-cols-3">
                <Info label="Location" value={inc.location} />
                <Info label="Department" value={inc.department} />
                <Info label="Patient" value={inc.patient ? `${inc.patient.name} (${inc.patient.uhid})` : null} />
              </dl>
              <p className="whitespace-pre-wrap">{inc.description}</p>
              {inc.immediateAction && (
                <div>
                  <div className="font-medium">Immediate action</div>
                  <p className="whitespace-pre-wrap text-muted-foreground">{inc.immediateAction}</p>
                </div>
              )}
              {(inc.rootCause || inc.contributingFactors.length > 0) && (
                <div>
                  <div className="font-medium">Root cause</div>
                  <p className="whitespace-pre-wrap text-muted-foreground">{inc.rootCause ?? '—'}</p>
                  {inc.contributingFactors.length > 0 && <p className="mt-1 text-muted-foreground">Contributing factors: {inc.contributingFactors.join(', ')}</p>}
                </div>
              )}
              {inc.closureNote && (
                <div>
                  <div className="font-medium">{inc.status === 'rejected' ? 'Rejected' : 'Closure note'}</div>
                  <p className="whitespace-pre-wrap text-muted-foreground">{inc.closureNote}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Corrective and preventive actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <CapaList items={inc.capas} />
              {open && <AddCapa sourceType="incident" sourceId={inc.id} defaultProblem={inc.description} onCreated={() => refresh()} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityList items={inc.activity} />
            </CardContent>
          </Card>
        </div>

        {canManage && open && <ReviewPanel inc={inc} onSaved={refresh} />}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value ?? '—'}</dd>
    </div>
  );
}

function ReviewPanel({ inc, onSaved }: { inc: Q.Incident; onSaved: (i: Q.Incident) => void }) {
  const next = Q.INCIDENT_TRANSITIONS[inc.status];
  const [status, setStatus] = React.useState<Q.IncidentStatus>(inc.status);
  const [assignedTo, setAssignedTo] = React.useState(inc.assignedTo?.id ?? '');
  const [severity, setSeverity] = React.useState(inc.severity);
  const [rootCause, setRootCause] = React.useState(inc.rootCause ?? '');
  const [factors, setFactors] = React.useState(inc.contributingFactors.join(', '));
  const [note, setNote] = React.useState('');
  const save = useMutation({
    mutationFn: () =>
      api.quality.incidents.review(inc.id, {
        status: status !== inc.status ? status : undefined,
        assignedTo: assignedTo || null,
        severity,
        rootCause: rootCause || undefined,
        contributingFactors: factors
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        note: note || undefined,
      }),
    onSuccess: (i) => {
      setNote('');
      setStatus(i.status);
      onSaved(i);
    },
  });
  const needsNote = status === 'closed' || status === 'rejected';
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Review</CardTitle>
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
            <select
              id="status"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value as Q.IncidentStatus)}
            >
              {[inc.status, ...next].map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="assignedTo" label="Investigator">
            <StaffSelect id="assignedTo" value={assignedTo} onChange={setAssignedTo} />
          </Field>
          <Field id="severity" label="Harm (after review)">
            <select
              id="severity"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Q.IncidentSeverity)}
            >
              {Q.INCIDENT_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="rootCause" label="Root cause">
            <Textarea id="rootCause" value={rootCause} onChange={(e) => setRootCause(e.target.value)} />
          </Field>
          <Field id="factors" label="Contributing factors" hint="Comma separated, e.g. Staffing, Communication">
            <Input id="factors" value={factors} onChange={(e) => setFactors(e.target.value)} />
          </Field>
          <Field id="note" label={needsNote ? (status === 'closed' ? 'Closure note *' : 'Why is this not an incident? *') : 'Note'}>
            <Textarea id="note" required={needsNote} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full" disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />} Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
