'use client';

import * as React from 'react';
import Link from 'next/link';
import { use } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { quality as Q } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/validate';
import { usePermission } from '@/lib/auth';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ActivityList, EnumSelect, ErrorBox, Field, StaffSelect, StatusBadge, Textarea, formatDateTime, todayIST } from '@/modules/quality/ui';

const SOURCE_LINK: Partial<Record<Q.CapaSource, string>> = {
  incident: '/quality/incidents/',
  complaint: '/quality/complaints/',
  audit: '/quality/audits/',
};

export default function CapaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = usePermission('quality.capa.read');
  const canManage = usePermission('quality.capa.manage');
  const queryClient = useQueryClient();
  const key = ['quality', 'capas', id];
  const { data: c, isPending, error } = useQuery({ queryKey: key, queryFn: () => api.quality.capas.get(id), enabled: can });
  if (!can) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  const saved = (next: Q.Capa) => {
    queryClient.setQueryData(key, next);
    queryClient.invalidateQueries({ queryKey: ['quality'], refetchType: 'none' });
  };
  const link = c.sourceId && SOURCE_LINK[c.sourceType];
  const open = c.status !== 'verified' && c.status !== 'cancelled';
  return (
    <div className="space-y-6">
      <Link href="/quality/capa" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
        <ArrowLeft /> All actions
      </Link>
      <div>
        <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
          {c.title} <StatusBadge status={c.status} overdue={c.overdue} />
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {c.capaNo} · owner {c.owner?.name ?? 'not set'} · due {c.dueDate}
          {c.sourceLabel && (
            <>
              {' · from '}
              {link ? (
                <Link className="text-primary hover:underline" href={`${link}${c.sourceId}`}>
                  {c.sourceLabel}
                </Link>
              ) : (
                c.sourceLabel
              )}
            </>
          )}
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardContent className="space-y-4 pt-6 text-sm">
              <Block title="Problem" text={c.problem} />
              <Block title="Root cause" text={c.rootCause} />
              <Block title="Corrective action" text={c.correctiveAction} />
              <Block title="Preventive action" text={c.preventiveAction} />
              {c.completionNote && <Block title={`Completed ${formatDateTime(c.completedAt)}`} text={c.completionNote} />}
              {c.effectivenessNote && <Block title={`Verified by ${c.verifiedBy?.name ?? '—'} ${formatDateTime(c.verifiedAt)}`} text={c.effectivenessNote} />}
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
        {canManage && open && <UpdatePanel key={c.status} c={c} onSaved={saved} />}
      </div>
    </div>
  );
}

function Block({ title, text }: { title: string; text: string | null }) {
  return (
    <div>
      <div className="font-medium">{title}</div>
      <p className="whitespace-pre-wrap text-muted-foreground">{text || '—'}</p>
    </div>
  );
}

const NOTE_LABEL: Partial<Record<Q.CapaStatus, string>> = {
  completed: 'What was done? *',
  verified: 'How was effectiveness checked? *',
  cancelled: 'Why cancel? *',
};

function UpdatePanel({ c, onSaved }: { c: Q.Capa; onSaved: (c: Q.Capa) => void }) {
  const [status, setStatus] = React.useState<Q.CapaStatus | ''>(c.status);
  const [f, setF] = React.useState({
    rootCause: c.rootCause ?? '',
    correctiveAction: c.correctiveAction ?? '',
    preventiveAction: c.preventiveAction ?? '',
    ownerId: c.owner?.id ?? '',
    dueDate: c.dueDate,
    note: '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const save = useMutation({
    mutationFn: () =>
      api.quality.capas.update(c.id, {
        status: status && status !== c.status ? status : undefined,
        rootCause: f.rootCause,
        correctiveAction: f.correctiveAction,
        preventiveAction: f.preventiveAction,
        ownerId: f.ownerId || null,
        dueDate: f.dueDate,
        note: f.note || undefined,
      }),
    onSuccess: onSaved,
  });
  const reopening = c.status === 'completed' && status === 'in_progress';
  const noteLabel = reopening ? 'Why was it not effective? *' : status && status !== c.status ? NOTE_LABEL[status] : undefined;
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Update</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const { errors: found } = validate(Q.updateCapaSchema, { dueDate: f.dueDate, note: f.note || undefined });
            const all: FieldErrors = { ...(found ?? {}) };
            if (f.dueDate !== c.dueDate && f.dueDate && f.dueDate < todayIST()) all.dueDate = 'Due date cannot be in the past';
            if (!f.dueDate) all.dueDate = 'Enter the due date';
            setErrors(all);
            if (!Object.keys(all).length) save.mutate();
          }}
        >
          <ErrorBox error={save.error} />
          <Field id="status" label="Status">
            <EnumSelect id="status" value={status} onChange={setStatus} options={[c.status, ...Q.CAPA_TRANSITIONS[c.status]]} />
          </Field>
          <Field id="owner" label="Owner">
            <StaffSelect id="owner" value={f.ownerId} onChange={(v) => setF({ ...f, ownerId: v })} placeholder="No owner" />
          </Field>
          <Field id="due" label="Due date" error={errors.dueDate}>
            <Input id="due" type="date" min={c.dueDate < todayIST() ? c.dueDate : todayIST()} value={f.dueDate} onChange={set('dueDate')} />
          </Field>
          <Field id="root" label="Root cause">
            <Textarea id="root" value={f.rootCause} onChange={set('rootCause')} />
          </Field>
          <Field id="corrective" label="Corrective action">
            <Textarea id="corrective" value={f.correctiveAction} onChange={set('correctiveAction')} />
          </Field>
          <Field id="preventive" label="Preventive action">
            <Textarea id="preventive" value={f.preventiveAction} onChange={set('preventiveAction')} />
          </Field>
          <Field id="note" label={noteLabel ?? 'Note'}>
            <Textarea id="note" required={!!noteLabel} value={f.note} onChange={set('note')} />
          </Field>
          <Button type="submit" className="w-full" disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />} Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
