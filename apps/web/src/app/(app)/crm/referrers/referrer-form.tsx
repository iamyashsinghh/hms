'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { crm as C } from '@hms/shared';
import { errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ErrorBox, Field, REFERRER_TYPE_LABELS, Select, Textarea } from '@/modules/crm/ui';

export function ReferrerForm({
  title,
  initial,
  saving,
  error,
  onCancel,
  onSave,
}: {
  title: string;
  initial?: C.Referrer;
  saving: boolean;
  error: unknown;
  onCancel: () => void;
  onSave: (body: C.ReferrerInput) => void;
}) {
  const [f, setF] = React.useState({
    type: initial?.type ?? ('doctor' as C.ReferrerType),
    name: initial?.name ?? '',
    mobile: initial?.mobile ?? '',
    email: initial?.email ?? '',
    organization: initial?.organization ?? '',
    city: initial?.city ?? '',
    registrationNo: initial?.registrationNo ?? '',
    pan: initial?.pan ?? '',
    notes: initial?.notes ?? '',
    isActive: initial?.isActive ?? true,
  });
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ErrorBox error={error ? errorMessage(error) : null} />
        <div className="grid gap-4 sm:grid-cols-4">
          <Field id="rf-type" label="Type">
            <Select id="rf-type" value={f.type} onChange={(e) => set({ type: e.target.value as C.ReferrerType })}>
              {C.REFERRER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {REFERRER_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="rf-name" label="Name *" className="sm:col-span-2">
            <Input id="rf-name" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Dr. Anil Kulkarni" />
          </Field>
          <Field id="rf-mobile" label="Mobile">
            <Input id="rf-mobile" inputMode="numeric" maxLength={10} value={f.mobile} onChange={(e) => set({ mobile: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field id="rf-org" label="Clinic / organisation" className="sm:col-span-2">
            <Input id="rf-org" value={f.organization} onChange={(e) => set({ organization: e.target.value })} />
          </Field>
          <Field id="rf-city" label="City">
            <Input id="rf-city" value={f.city} onChange={(e) => set({ city: e.target.value })} />
          </Field>
          <Field id="rf-email" label="Email">
            <Input id="rf-email" type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} />
          </Field>
          <Field id="rf-reg" label="Registration no.">
            <Input id="rf-reg" value={f.registrationNo} onChange={(e) => set({ registrationNo: e.target.value })} />
          </Field>
          <Field id="rf-pan" label="PAN (for TDS)">
            <Input id="rf-pan" maxLength={10} value={f.pan} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} />
          </Field>
          <Field id="rf-notes" label="Notes" className="sm:col-span-2">
            <Textarea id="rf-notes" className="min-h-9" value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.isActive} onChange={(e) => set({ isActive: e.target.checked })} /> Active
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={saving || !f.name.trim()}
            onClick={() =>
              onSave({
                type: f.type,
                name: f.name,
                mobile: f.mobile || null,
                email: f.email || null,
                organization: f.organization || null,
                city: f.city || null,
                registrationNo: f.registrationNo || null,
                pan: f.pan || null,
                notes: f.notes || null,
                isActive: f.isActive,
              })
            }
          >
            {saving && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
