'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { quality as Q } from '@hms/shared';
import { api } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/validate';
import { Can } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorBox, Field, StaffSelect, Textarea, todayIST } from './ui';

/** "Add corrective action" form for an incident, complaint, audit or infection case. */
export function AddCapa({
  sourceType,
  sourceId,
  defaultProblem = '',
  onCreated,
}: {
  sourceType: Q.CapaSource;
  sourceId?: string;
  defaultProblem?: string;
  onCreated: (c: Q.Capa) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const empty = { title: '', problem: defaultProblem, rootCause: '', correctiveAction: '', preventiveAction: '', ownerId: '', dueDate: todayIST() };
  const [f, setF] = React.useState(empty);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const create = useMutation({
    mutationFn: (body: Q.CreateCapa) => api.quality.capas.create(body),
    onSuccess: (c) => {
      setOpen(false);
      setF(empty);
      onCreated(c);
    },
  });
  const body = (): Q.CreateCapa => ({
        sourceType,
        sourceId,
        title: f.title,
        problem: f.problem,
        rootCause: f.rootCause || undefined,
        correctiveAction: f.correctiveAction || undefined,
        preventiveAction: f.preventiveAction || undefined,
        ownerId: f.ownerId || undefined,
        dueDate: f.dueDate,
      });

  return (
    <Can permission="quality.capa.manage">
      {!open ? (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Plus /> Add corrective action
        </Button>
      ) : (
        <form
          className="space-y-4 rounded-md border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const b = body();
            const { errors: found } = validate(Q.createCapaSchema, b);
            setErrors(found ?? {});
            if (!found) create.mutate(b);
          }}
        >
          <ErrorBox error={Object.keys(errors).length ? (errors.sourceId ?? 'Please correct the highlighted fields') : create.error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="capa-title" label="Action title *" className="sm:col-span-2" error={errors.title}>
              <Input id="capa-title" required maxLength={200} value={f.title} onChange={set('title')} placeholder="e.g. Two-nurse check for high-alert drugs" />
            </Field>
            <Field id="capa-problem" label="Problem *" className="sm:col-span-2" error={errors.problem}>
              <Textarea id="capa-problem" required value={f.problem} onChange={set('problem')} />
            </Field>
            <Field id="capa-root" label="Root cause">
              <Textarea id="capa-root" value={f.rootCause} onChange={set('rootCause')} />
            </Field>
            <Field id="capa-corrective" label="Corrective action">
              <Textarea id="capa-corrective" value={f.correctiveAction} onChange={set('correctiveAction')} />
            </Field>
            <Field id="capa-preventive" label="Preventive action">
              <Textarea id="capa-preventive" value={f.preventiveAction} onChange={set('preventiveAction')} />
            </Field>
            <div className="space-y-4">
              <Field id="capa-owner" label="Owner">
                <StaffSelect id="capa-owner" value={f.ownerId} onChange={(v) => setF({ ...f, ownerId: v })} placeholder="Pick owner" />
              </Field>
              <Field id="capa-due" label="Due date *" error={errors.dueDate}>
                <Input id="capa-due" type="date" required min={todayIST()} value={f.dueDate} onChange={set('dueDate')} />
              </Field>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" />} Save action
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Can>
  );
}
