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
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PatientPolicyPicker } from '@/modules/insurance/policy-select';
import { ErrorBox, Field, formatINR, opt } from '@/modules/insurance/ui';

export default function Page() {
  return (
    <React.Suspense>
      <NewClaimPage />
    </React.Suspense>
  );
}

function NewClaimPage() {
  const canManage = usePermission('insurance.claim.manage');
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [policy, setPolicy] = React.useState<I.Policy | null>(null);
  const [preauthId, setPreauthId] = React.useState(params.get('preauthId') ?? '');
  const [claimType, setClaimType] = React.useState<I.ClaimType>('cashless');
  const [picked, setPicked] = React.useState<Record<string, { on: boolean; share: string }>>({});
  const [v, setV] = React.useState({ admissionDate: '', dischargeDate: '', diagnosis: '', notes: '' });

  const preauths = useQuery({
    queryKey: ['insurance', 'preauths', { patientId: policy?.patientId, status: 'approved' }],
    queryFn: () => api.insurance.preauths.list({ patientId: policy!.patientId, status: 'approved' }),
    enabled: !!policy,
  });
  const bills = useQuery({
    queryKey: ['billing', 'invoices', { patientId: policy?.patientId, status: 'final' }],
    queryFn: () => api.billing.invoices.list({ patientId: policy!.patientId, status: 'final', pageSize: 100 }),
    enabled: !!policy,
  });
  const open = (bills.data?.items ?? []).filter((b) => b.balance > 0);
  const usable = (preauths.data?.items ?? []).filter((p) => p.policyId === policy?.id);

  const [errors, setErrors] = React.useState<FieldErrors>({});
  const create = useMutation({
    mutationFn: (body: I.ClaimInput) => api.insurance.claims.create(body),
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: ['insurance', 'claims'] });
      router.push(`/insurance/claims/${c.id}`);
    },
  });

  const submit = () => {
    if (!policy) return;
    const chosen = Object.entries(picked).filter(([, x]) => x.on);
    const body: I.ClaimInput = {
      policyId: policy.id,
      preauthId: preauthId || null,
      claimType,
      invoices: chosen.map(([invoiceId, x]) => ({ invoiceId, payerAmount: x.share.trim() === '' ? undefined : Number(x.share) })),
      admissionDate: v.admissionDate || null,
      dischargeDate: v.dischargeDate || null,
      diagnosis: opt(v.diagnosis) ?? null,
      notes: opt(v.notes) ?? null,
    };
    const r = validate(I.claimInputSchema, body);
    const errs: FieldErrors = { ...(r.errors ?? {}) };
    // A payer share cannot be more than what is unpaid on that bill.
    for (const [invoiceId, x] of chosen) {
      const bill = open.find((b) => b.id === invoiceId);
      if (bill && x.share.trim() !== '' && Number(x.share) > bill.balance) errs[`share.${invoiceId}`] = `More than the unpaid ${formatINR(bill.balance)}`;
    }
    for (const [k, m] of Object.entries(errs)) {
      const n = /^invoices\.(\d+)\./.exec(k)?.[1];
      if (n !== undefined && chosen[Number(n)]) errs[`share.${chosen[Number(n)]![0]}`] = m;
    }
    setErrors(errs);
    if (r.data && !Object.keys(errs).length) create.mutate(body);
  };

  if (!canManage) return <NoAccess />;
  const count = Object.values(picked).filter((x) => x.on).length;

  return (
    <>
      <Link href="/insurance/claims" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> Claims
      </Link>
      <PageHeader
        title="Prepare a claim"
        description="Pick the patient's policy and final bills. Leave the payer share blank to use the unpaid amount less co-pay, within the pre-auth and sum insured."
      />
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (policy && count) submit();
        }}
      >
        <Card>
          <CardContent className="space-y-4 pt-6">
            <PatientPolicyPicker
              presetPolicyId={params.get('policyId')}
              value={policy}
              onChange={(p) => {
                setPolicy(p);
                if (p) setClaimType(p.payerType === 'corporate' ? 'credit' : 'cashless');
              }}
            />
            {policy && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field id="preauth" label="Approved pre-auth">
                  <Select id="preauth" value={preauthId} onChange={(e) => setPreauthId(e.target.value)}>
                    <option value="">None</option>
                    {usable.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.number} · {formatINR(p.approvedAmount)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id="type" label="Claim type">
                  <Select id="type" value={claimType} onChange={(e) => setClaimType(e.target.value as I.ClaimType)}>
                    <option value="cashless">Cashless</option>
                    <option value="credit">Corporate / scheme credit</option>
                  </Select>
                </Field>
                <Field id="adm" label="Admission date" error={errors.admissionDate}>
                  <Input id="adm" type="date" max={todayIso()} value={v.admissionDate} onChange={(e) => setV({ ...v, admissionDate: e.target.value })} />
                </Field>
                <Field id="dis" label="Discharge date" error={errors.dischargeDate}>
                  <Input id="dis" type="date" min={v.admissionDate || undefined} max={todayIso()} value={v.dischargeDate} onChange={(e) => setV({ ...v, dischargeDate: e.target.value })} />
                </Field>
                <Field id="dx" label="Final diagnosis" className="sm:col-span-2">
                  <Input id="dx" maxLength={1000} value={v.diagnosis} onChange={(e) => setV({ ...v, diagnosis: e.target.value })} placeholder="Defaults to the pre-auth diagnosis" />
                </Field>
                <Field id="notes" label="Notes" className="sm:col-span-2">
                  <Input id="notes" maxLength={1000} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
                </Field>
              </div>
            )}
          </CardContent>
        </Card>

        {policy && (
          <Card>
            <CardHeader>
              <CardTitle>Bills with money due</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10" />
                  <TableHead>Bill</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Unpaid</TableHead>
                  <TableHead className="w-44 text-right">Payer share ₹</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {open.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      {bills.isPending ? 'Loading…' : 'No final bills with money due for this patient.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  open.map((b) => {
                    const row = picked[b.id] ?? { on: false, share: '' };
                    return (
                      <TableRow key={b.id}>
                        <TableCell>
                          <input type="checkbox" aria-label={`Claim ${b.number}`} checked={row.on} onChange={(e) => setPicked((p) => ({ ...p, [b.id]: { ...row, on: e.target.checked } }))} />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{b.number}</TableCell>
                        <TableCell>{formatDate(b.invoiceDate)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatINR(b.total)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatINR(b.balance)}</TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            max={b.balance}
                            className="text-right"
                            placeholder="Auto"
                            disabled={!row.on}
                            value={row.share}
                            onChange={(e) => setPicked((p) => ({ ...p, [b.id]: { ...row, share: e.target.value } }))}
                          />
                          {errors[`share.${b.id}`] && <p className="mt-1 text-right text-xs text-destructive">{errors[`share.${b.id}`]}</p>}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </Card>
        )}
        <ErrorBox error={create.error ? errorMessage(create.error) : null} />
        <div className="flex justify-end">
          <Button type="submit" disabled={!policy || !count || create.isPending}>
            {create.isPending && <Loader2 className="animate-spin" />}
            Create claim ({count} {count === 1 ? 'bill' : 'bills'})
          </Button>
        </div>
      </form>
    </>
  );
}
