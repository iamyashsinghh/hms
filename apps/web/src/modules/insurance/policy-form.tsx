'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { insurance as I, type Patient } from '@hms/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { ErrorBox, Field, PatientPicker, PAYER_TYPE_LABELS, RELATION_LABELS, opt, optNum } from './ui';

/** Add / edit a patient's insurance policy, corporate cover or scheme card. */
export function PolicyForm({
  policy,
  patient: presetPatient,
  onSubmit,
  pending,
  error,
}: {
  policy?: I.Policy;
  patient?: Patient | null;
  onSubmit: (body: I.PolicyInput) => void;
  pending: boolean;
  error: string | null;
}) {
  const [patient, setPatient] = React.useState<Patient | null>(presetPatient ?? null);
  const [v, setV] = React.useState({
    payerId: policy?.payerId ?? '',
    tpaId: policy?.tpaId ?? '',
    policyNumber: policy?.policyNumber ?? '',
    memberId: policy?.memberId ?? '',
    holderName: policy?.holderName ?? '',
    relation: policy?.relation ?? 'self',
    employeeId: policy?.employeeId ?? '',
    validFrom: policy?.validFrom ?? '',
    validTo: policy?.validTo ?? '',
    sumInsured: policy?.sumInsured != null ? String(policy.sumInsured) : '',
    copayPercent: policy?.copayPercent != null ? String(policy.copayPercent) : '',
    roomRentLimit: policy?.roomRentLimit != null ? String(policy.roomRentLimit) : '',
    notes: policy?.notes ?? '',
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const payers = useQuery({ queryKey: ['insurance', 'payers', { active: 'true', all: true }], queryFn: () => api.insurance.payers.list({ active: 'true', pageSize: 200 }) });
  const list = payers.data?.items ?? [];
  const carriers = list.filter((p) => p.type !== 'tpa');
  const tpas = list.filter((p) => p.type === 'tpa');
  const carrier = list.find((p) => p.id === v.payerId);

  return (
    <form
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!policy && !patient) return;
        onSubmit({
          patientId: policy?.patientId ?? patient!.id,
          payerId: v.payerId,
          tpaId: v.tpaId || null,
          policyNumber: v.policyNumber,
          memberId: opt(v.memberId) ?? null,
          holderName: opt(v.holderName) ?? null,
          relation: v.relation as I.Relation,
          employeeId: opt(v.employeeId) ?? null,
          validFrom: v.validFrom || null,
          validTo: v.validTo || null,
          sumInsured: optNum(v.sumInsured) ?? null,
          copayPercent: optNum(v.copayPercent) ?? null,
          roomRentLimit: optNum(v.roomRentLimit) ?? null,
          notes: opt(v.notes) ?? null,
        });
      }}
    >
      {!policy && (
        <div className="sm:col-span-2">
          <PatientPicker value={patient} onChange={setPatient} />
        </div>
      )}
      <Field id="payer" label="Insurer / corporate / scheme" className="sm:col-span-2">
        <Select id="payer" required value={v.payerId} onChange={set('payerId')}>
          <option value="">Choose…</option>
          {carriers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({PAYER_TYPE_LABELS[p.type]})
            </option>
          ))}
        </Select>
      </Field>
      {carrier?.type === 'insurer' && (
        <Field id="tpa" label="TPA (if claims go through one)" className="sm:col-span-2">
          <Select id="tpa" value={v.tpaId} onChange={set('tpaId')}>
            <option value="">No TPA, insurer direct</option>
            {tpas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field id="policyNumber" label={carrier?.type === 'government' ? 'Scheme / card number' : 'Policy number'}>
        <Input id="policyNumber" required value={v.policyNumber} onChange={set('policyNumber')} />
      </Field>
      <Field id="memberId" label="Member / e-card / beneficiary ID">
        <Input id="memberId" value={v.memberId} onChange={set('memberId')} />
      </Field>
      <Field id="holder" label="Policy holder">
        <Input id="holder" value={v.holderName} onChange={set('holderName')} />
      </Field>
      <Field id="relation" label="Patient is holder's">
        <Select id="relation" value={v.relation} onChange={set('relation')}>
          {I.RELATIONS.map((r) => (
            <option key={r} value={r}>
              {RELATION_LABELS[r]}
            </option>
          ))}
        </Select>
      </Field>
      {carrier?.type === 'corporate' && (
        <Field id="emp" label="Employee code">
          <Input id="emp" value={v.employeeId} onChange={set('employeeId')} />
        </Field>
      )}
      <Field id="from" label="Valid from">
        <Input id="from" type="date" value={v.validFrom} onChange={set('validFrom')} />
      </Field>
      <Field id="to" label="Valid to">
        <Input id="to" type="date" value={v.validTo} onChange={set('validTo')} />
      </Field>
      <Field id="si" label="Sum insured (₹)">
        <Input id="si" type="number" step="0.01" min={0} value={v.sumInsured} onChange={set('sumInsured')} />
      </Field>
      <Field id="copay" label={`Co-pay % ${carrier ? `(payer default ${carrier.copayPercent}%)` : ''}`}>
        <Input id="copay" type="number" step="0.01" min={0} max={100} value={v.copayPercent} onChange={set('copayPercent')} />
      </Field>
      <Field id="room" label="Room rent limit / day (₹)">
        <Input id="room" type="number" step="0.01" min={0} value={v.roomRentLimit} onChange={set('roomRentLimit')} />
      </Field>
      <Field id="notes" label="Notes" className="sm:col-span-2 lg:col-span-3">
        <Input id="notes" value={v.notes} onChange={set('notes')} />
      </Field>
      <div className="flex items-end justify-end gap-2 sm:col-span-2 lg:col-span-4">
        <div className="flex-1">
          <ErrorBox error={error} />
        </div>
        <Button type="submit" disabled={pending || (!policy && !patient)}>
          {pending && <Loader2 className="animate-spin" />}
          {policy ? 'Save policy' : 'Add policy'}
        </Button>
      </div>
    </form>
  );
}
