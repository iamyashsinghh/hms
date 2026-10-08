'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { insurance as I, todayIso } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/validate';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { PatientPolicyPicker } from '@/modules/insurance/policy-select';
import { ErrorBox, Field, formatINR, opt, optNum } from '@/modules/insurance/ui';

export default function Page() {
  return (
    <React.Suspense>
      <NewPreauthPage />
    </React.Suspense>
  );
}

function NewPreauthPage() {
  const canManage = usePermission('insurance.preauth.manage');
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [policy, setPolicy] = React.useState<I.Policy | null>(null);
  const [v, setV] = React.useState({ packageId: '', admissionRef: '', diagnosis: '', icdCodes: '', procedure: '', expectedAdmission: '', expectedLosDays: '', estimatedAmount: '', notes: '' });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const packages = useQuery({
    queryKey: ['insurance', 'packages', policy?.payerId],
    queryFn: () => api.insurance.payers.packages(policy!.payerId),
    enabled: !!policy,
  });
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const create = useMutation({
    mutationFn: (body: I.PreauthInput) => api.insurance.preauths.create(body),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: ['insurance', 'preauths'] });
      router.push(`/insurance/preauths/${p.id}`);
    },
  });

  const submit = () => {
    if (!policy) return;
    const body: I.PreauthInput = {
      policyId: policy.id,
      packageId: v.packageId || null,
      admissionRef: opt(v.admissionRef) ?? null,
      diagnosis: v.diagnosis,
      icdCodes: v.icdCodes.split(/[,\s]+/).filter(Boolean),
      procedure: opt(v.procedure) ?? null,
      expectedAdmission: v.expectedAdmission || null,
      expectedLosDays: optNum(v.expectedLosDays) ?? null,
      estimatedAmount: v.estimatedAmount.trim() === '' ? undefined : Number(v.estimatedAmount),
      notes: opt(v.notes) ?? null,
    };
    const r = validate(I.preauthInputSchema, body);
    const errs = { ...(r.errors ?? {}) };
    const icd = Object.entries(errs).find(([k]) => k.startsWith('icdCodes'));
    if (icd) errs.icdCodes = icd[1];
    setErrors(errs);
    if (r.data) create.mutate(body);
  };

  if (!canManage) return <NoAccess />;

  return (
    <>
      <Link href="/insurance/preauths" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> Pre-auths
      </Link>
      <PageHeader title="New pre-authorisation" description="Saved as a draft; submit it to the payer from the next screen." />
      <Card>
        <CardContent className="pt-6">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <PatientPolicyPicker presetPolicyId={params.get('policyId')} value={policy} onChange={setPolicy} />
            {policy && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field id="diagnosis" error={errors.diagnosis} label="Provisional diagnosis" className="sm:col-span-2">
                  <Input id="diagnosis" required maxLength={1000} value={v.diagnosis} onChange={set('diagnosis')} />
                </Field>
                <Field id="icd" error={errors.icdCodes} label="ICD-10 codes (comma separated)">
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
                  </Select>
                </Field>
                <Field id="procedure" error={errors.procedure} label="Planned treatment / procedure" className="sm:col-span-2">
                  <Input id="procedure" value={v.procedure} onChange={set('procedure')} />
                </Field>
                <Field id="adm" error={errors.expectedAdmission} label="Expected admission">
                  <Input id="adm" type="date" min={todayIso(-30)} max={todayIso(366)} value={v.expectedAdmission} onChange={set('expectedAdmission')} />
                </Field>
                <Field id="los" error={errors.expectedLosDays} label="Expected stay (days)">
                  <Input id="los" type="number" min={0} max={365} step={1} value={v.expectedLosDays} onChange={set('expectedLosDays')} />
                </Field>
                <Field id="est" error={errors.estimatedAmount} label="Estimated cost (₹)">
                  <Input id="est" type="number" step="0.01" min={0} required value={v.estimatedAmount} onChange={set('estimatedAmount')} />
                </Field>
                <Field id="ref" error={errors.admissionRef} label="Admission / IP number">
                  <Input id="ref" value={v.admissionRef} onChange={set('admissionRef')} />
                </Field>
                <Field id="notes" error={errors.notes} label="Notes" className="sm:col-span-2">
                  <Input id="notes" value={v.notes} onChange={set('notes')} />
                </Field>
              </div>
            )}
            <ErrorBox error={create.error ? errorMessage(create.error) : null} />
            <div className="flex justify-end">
              <Button type="submit" disabled={!policy || create.isPending}>
                {create.isPending && <Loader2 className="animate-spin" />}
                Save draft
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
