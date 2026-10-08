'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { insurance as I } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { ErrorBox, Field, formatINR, opt, optNum } from '@/modules/insurance/ui';

/** Pre-auth statuses the API lets you edit (PATCH /insurance/preauths/:id). */
export const PREAUTH_EDITABLE: I.PreauthStatus[] = ['draft', 'query'];

type Values = {
  packageId: string;
  admissionRef: string;
  diagnosis: string;
  icdCodes: string;
  procedure: string;
  expectedAdmission: string;
  expectedLosDays: string;
  estimatedAmount: string;
  requestedAmount: string;
  notes: string;
};

const valuesOf = (p?: I.Preauth): Values => ({
  packageId: p?.packageId ?? '',
  admissionRef: p?.admissionRef ?? '',
  diagnosis: p?.diagnosis ?? '',
  icdCodes: p?.icdCodes.join(', ') ?? '',
  procedure: p?.procedure ?? '',
  expectedAdmission: p?.expectedAdmission ?? '',
  expectedLosDays: p?.expectedLosDays != null ? String(p.expectedLosDays) : '',
  estimatedAmount: p ? String(p.estimatedAmount) : '',
  requestedAmount: p ? String(p.requestedAmount) : '',
  notes: p?.notes ?? '',
});

/**
 * Pre-auth details for a policy: creates a draft, or edits one (`preauth` given) while it is a draft
 * or under query. Validated with the shared Zod schema before it is sent; server errors are shown.
 */
export function PreauthForm({ policy, preauth, onCancel }: { policy: I.Policy; preauth?: I.Preauth; onCancel?: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [v, setV] = React.useState<Values>(() => valuesOf(preauth));
  const [formError, setFormError] = React.useState<string | null>(null);
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const packages = useQuery({
    queryKey: ['insurance', 'packages', policy.payerId],
    queryFn: () => api.insurance.payers.packages(policy.payerId),
  });

  const body = (): I.UpdatePreauth => ({
    packageId: v.packageId || null,
    admissionRef: opt(v.admissionRef) ?? null,
    diagnosis: v.diagnosis.trim(),
    icdCodes: v.icdCodes.split(/[,\s]+/).filter(Boolean),
    procedure: opt(v.procedure) ?? null,
    expectedAdmission: v.expectedAdmission || null,
    expectedLosDays: optNum(v.expectedLosDays) ?? null,
    estimatedAmount: Number(v.estimatedAmount),
    ...(preauth && v.requestedAmount.trim() !== '' && { requestedAmount: Number(v.requestedAmount) }),
    notes: opt(v.notes) ?? null,
  });

  const save = useMutation({
    mutationFn: (b: I.UpdatePreauth) =>
      preauth ? api.insurance.preauths.update(preauth.id, b) : api.insurance.preauths.create({ ...b, policyId: policy.id, diagnosis: b.diagnosis!, estimatedAmount: b.estimatedAmount! }),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: ['insurance', 'preauths'] });
      router.push(`/insurance/preauths/${p.id}`);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (v.estimatedAmount.trim() === '') return setFormError('Enter the estimated cost');
    const b = body();
    const parsed = (preauth ? I.updatePreauthSchema : I.preauthInputSchema).safeParse({ ...b, policyId: policy.id });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return setFormError(issue ? `${issue.path.join('.') || 'Form'}: ${issue.message}` : 'Check the form');
    }
    if (preauth && b.requestedAmount != null && Number(b.requestedAmount) <= 0) return setFormError('Requested amount must be more than 0');
    save.mutate(b);
  };

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="diagnosis" label="Provisional diagnosis *" className="sm:col-span-2">
          <Input id="diagnosis" required minLength={2} maxLength={1000} value={v.diagnosis} onChange={set('diagnosis')} />
        </Field>
        <Field id="icd" label="ICD-10 codes (comma separated)">
          <Input id="icd" value={v.icdCodes} onChange={set('icdCodes')} placeholder="K35.8" />
        </Field>
        <Field id="package" label="Package">
          <Select
            id="package"
            value={v.packageId}
            onChange={(e) => {
              const pkg = packages.data?.find((p) => p.id === e.target.value);
              setV((s) => ({
                ...s,
                packageId: e.target.value,
                ...(pkg && { procedure: s.procedure || pkg.name, estimatedAmount: s.estimatedAmount || String(pkg.rate), expectedLosDays: s.expectedLosDays || String(pkg.losDays ?? '') }),
              }));
            }}
          >
            <option value="">No package</option>
            {(packages.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name} · {formatINR(p.rate)}
              </option>
            ))}
            {preauth?.packageId && !packages.data?.some((p) => p.id === preauth.packageId) && (
              <option value={preauth.packageId}>
                {preauth.packageCode} · {preauth.packageName}
              </option>
            )}
          </Select>
        </Field>
        <Field id="procedure" label="Planned treatment / procedure" className="sm:col-span-2">
          <Input id="procedure" maxLength={1000} value={v.procedure} onChange={set('procedure')} />
        </Field>
        <Field id="adm" label="Expected admission">
          <Input id="adm" type="date" value={v.expectedAdmission} onChange={set('expectedAdmission')} />
        </Field>
        <Field id="los" label="Expected stay (days)">
          <Input id="los" type="number" min={0} max={365} step={1} value={v.expectedLosDays} onChange={set('expectedLosDays')} />
        </Field>
        <Field id="est" label="Estimated cost (₹) *">
          <Input id="est" type="number" step="0.01" min={0} required value={v.estimatedAmount} onChange={set('estimatedAmount')} />
        </Field>
        {preauth && (
          <Field id="req" label="Requested from payer (₹)">
            <Input id="req" type="number" step="0.01" min={0} value={v.requestedAmount} onChange={set('requestedAmount')} />
          </Field>
        )}
        <Field id="ref" label="Admission / IP number">
          <Input id="ref" maxLength={100} value={v.admissionRef} onChange={set('admissionRef')} />
        </Field>
        <Field id="notes" label="Notes" className="sm:col-span-2">
          <Input id="notes" maxLength={1000} value={v.notes} onChange={set('notes')} />
        </Field>
      </div>
      <ErrorBox error={formError ?? (save.error ? errorMessage(save.error) : null)} />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />}
          {preauth ? 'Save changes' : 'Save draft'}
        </Button>
      </div>
    </form>
  );
}
