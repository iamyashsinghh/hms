'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Patient, insurance as I } from '@hms/shared';
import { api } from '@/lib/api';
import { Select } from '@/components/ui/input';
import { Field, PatientPicker, coverText } from './ui';

/** Pick a patient, then one of their active policies. A `?policyId=` preset skips the patient step. */
export function PatientPolicyPicker({ presetPolicyId, value, onChange }: { presetPolicyId?: string | null; value: I.Policy | null; onChange: (p: I.Policy | null) => void }) {
  const [patient, setPatient] = React.useState<Patient | null>(null);
  React.useEffect(() => {
    if (presetPolicyId) api.insurance.policies.get(presetPolicyId).then(onChange).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetPolicyId]);
  React.useEffect(() => {
    if (value && !patient) api.patients.get(value.patientId).then(setPatient).catch(() => undefined);
  }, [value, patient]);
  const policies = useQuery({
    queryKey: ['insurance', 'policies', { patientId: patient?.id, active: 'true' }],
    queryFn: () => api.insurance.policies.list({ patientId: patient!.id, active: 'true' }),
    enabled: !!patient,
  });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <PatientPicker
        value={patient}
        onChange={(p) => {
          setPatient(p);
          onChange(null);
        }}
      />
      {patient && (
        <Field id="policy" label="Policy">
          <Select id="policy" required value={value?.id ?? ''} onChange={(e) => onChange(policies.data?.items.find((p) => p.id === e.target.value) ?? null)}>
            <option value="">{policies.data?.items.length === 0 ? 'No active policy: add one first' : 'Choose…'}</option>
            {(policies.data?.items ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.payerName}
                {p.tpaName ? ` via ${p.tpaName}` : ''} · {p.policyNumber} · {coverText(p)}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </div>
  );
}
