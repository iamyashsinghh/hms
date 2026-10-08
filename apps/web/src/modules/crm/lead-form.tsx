'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { crm as C } from '@hms/shared';
import { errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  CampSelect,
  ErrorBox,
  Field,
  LEAD_SOURCE_LABELS,
  ReferrerSelect,
  Select,
  StaffSelect,
  Textarea,
  firstIssue,
  fromLocalInput,
  toLocalInput,
} from './ui';

const LABELS: Record<string, string> = {
  name: 'Name',
  mobile: 'Mobile',
  email: 'Email',
  ageYears: 'Age',
  city: 'City',
  interest: 'Looking for',
  notes: 'Notes',
  nextFollowUpAt: 'Next call',
};

/** New-enquiry form; with `initial` it edits that enquiry (same fields, same validation). */
export function LeadForm({
  initial,
  saving,
  error,
  onCancel,
  onSave,
}: {
  initial?: C.Lead;
  saving: boolean;
  error: unknown;
  onCancel: () => void;
  onSave: (body: C.LeadInput) => void;
}) {
  const [f, setF] = React.useState({
    name: initial?.name ?? '',
    mobile: initial?.mobile ?? '',
    email: initial?.email ?? '',
    gender: initial?.gender ?? '',
    ageYears: initial?.ageYears != null ? String(initial.ageYears) : '',
    city: initial?.city ?? '',
    source: initial?.source ?? ('walk_in' as C.LeadSource),
    interest: initial?.interest ?? '',
    notes: initial?.notes ?? '',
    nextFollowUpAt: toLocalInput(initial?.nextFollowUpAt),
    referrerId: initial?.referrerId ?? '',
    campId: initial?.campId ?? '',
    assignedTo: initial?.assignedTo ?? '',
  });
  const [invalid, setInvalid] = React.useState<string | null>(null);
  const set = (patch: Partial<typeof f>) => {
    setF({ ...f, ...patch });
    setInvalid(null);
  };

  const submit = () => {
    const body: C.LeadInput = {
      name: f.name,
      mobile: f.mobile || null,
      email: f.email.trim() || null,
      gender: (f.gender || null) as C.LeadInput['gender'],
      ageYears: f.ageYears ? Number(f.ageYears) : null,
      city: f.city || null,
      source: f.source,
      interest: f.interest || null,
      notes: f.notes || null,
      nextFollowUpAt: fromLocalInput(f.nextFollowUpAt),
      referrerId: f.referrerId || null,
      campId: f.campId || null,
      assignedTo: f.assignedTo || null,
    };
    const problem = firstIssue(C.leadInputSchema, body, LABELS);
    if (problem) return setInvalid(problem);
    onSave(body);
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{initial ? 'Edit enquiry' : 'New enquiry'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ErrorBox error={invalid ?? (error ? errorMessage(error) : null)} />
        <div className="grid gap-4 sm:grid-cols-4">
          <Field id="ld-name" label="Name *" className="sm:col-span-2">
            <Input id="ld-name" maxLength={200} value={f.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field id="ld-mobile" label="Mobile">
            <Input id="ld-mobile" inputMode="numeric" maxLength={10} value={f.mobile} onChange={(e) => set({ mobile: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field id="ld-email" label="Email">
            <Input id="ld-email" type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} />
          </Field>
          <Field id="ld-gender" label="Gender">
            <Select id="ld-gender" value={f.gender} onChange={(e) => set({ gender: e.target.value as typeof f.gender })}>
              <option value="">—</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field id="ld-age" label="Age">
            <Input id="ld-age" type="number" min={0} max={130} step={1} value={f.ageYears} onChange={(e) => set({ ageYears: e.target.value })} />
          </Field>
          <Field id="ld-city" label="City / area">
            <Input id="ld-city" maxLength={100} value={f.city} onChange={(e) => set({ city: e.target.value })} />
          </Field>
          <Field id="ld-source" label="Source">
            <Select id="ld-source" value={f.source} onChange={(e) => set({ source: e.target.value as C.LeadSource })}>
              {C.LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_SOURCE_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="ld-interest" label="Looking for" className="sm:col-span-2">
            <Input id="ld-interest" maxLength={200} placeholder="e.g. Cataract surgery, Cardiology OPD" value={f.interest} onChange={(e) => set({ interest: e.target.value })} />
          </Field>
          <Field id="ld-next" label="Next call">
            <Input id="ld-next" type="datetime-local" value={f.nextFollowUpAt} onChange={(e) => set({ nextFollowUpAt: e.target.value })} />
          </Field>
          <Field id="ld-assigned" label="Assigned to">
            <StaffSelect id="ld-assigned" value={f.assignedTo} onChange={(assignedTo) => set({ assignedTo })} />
          </Field>
          <Field id="ld-ref" label="Referred by">
            <ReferrerSelect id="ld-ref" value={f.referrerId} onChange={(referrerId) => set({ referrerId })} />
          </Field>
          <Field id="ld-camp" label="Health camp">
            <CampSelect id="ld-camp" value={f.campId} onChange={(campId) => set({ campId })} />
          </Field>
          <Field id="ld-notes" label="Notes" className="sm:col-span-4">
            <Textarea id="ld-notes" maxLength={2000} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={saving || !f.name.trim() || (!f.mobile && !f.email.trim())} onClick={submit}>
            {saving && <Loader2 className="animate-spin" />}
            {initial ? 'Save changes' : 'Save enquiry'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
