'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { ipd as I, todayIso, type Patient } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/validate';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { ADMISSION_TYPE_LABELS, ErrorBox, Field, PatientPicker, Textarea, formatINR } from '@/modules/ipd/ui';

export default function AdmitPageWrapper() {
  return (
    <React.Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <AdmitPage />
    </React.Suspense>
  );
}

function AdmitPage() {
  const canAdmit = usePermission('ipd.admission.create');
  const canAdvance = usePermission('ipd.advance.collect');
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();

  const [patient, setPatient] = React.useState<Patient | null>(null);
  const [bedId, setBedId] = React.useState(params.get('bedId') ?? '');
  const [doctorId, setDoctorId] = React.useState('');
  const [admissionType, setAdmissionType] = React.useState<I.AdmissionType>('planned');
  const [reason, setReason] = React.useState('');
  const [diagnosis, setDiagnosis] = React.useState('');
  const [isMlc, setIsMlc] = React.useState(false);
  const [mlcNo, setMlcNo] = React.useState('');
  const [attendant, setAttendant] = React.useState({ name: '', relation: '', mobile: '' });
  const [expected, setExpected] = React.useState('');
  const [advance, setAdvance] = React.useState({ amount: '', mode: 'cash' as I.AdvanceMode, reference: '' });
  const [formError, setFormError] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<FieldErrors>({});

  const presetPatient = params.get('patientId');
  React.useEffect(() => {
    if (presetPatient) api.patients.get(presetPatient).then(setPatient).catch(() => undefined);
  }, [presetPatient]);

  const { data: board } = useQuery({ queryKey: ['ipd', 'bed-board'], queryFn: () => api.ipd.bedBoard(), enabled: canAdmit });
  const { data: doctors } = useQuery({ queryKey: ['setup', 'doctors'], queryFn: () => api.setup.listDoctors(), enabled: canAdmit });

  const freeBeds = React.useMemo(
    () =>
      (board?.wards ?? []).flatMap((w) =>
        w.beds.filter((b) => b.status === 'available' || b.status === 'reserved').map((b) => ({ ...b, wardName: w.name })),
      ),
    [board],
  );
  const bed = freeBeds.find((b) => b.id === bedId);

  const admit = useMutation({
    mutationFn: (body: I.AdmitInput) => api.ipd.admissions.admit(body),
    onSuccess: (a) => {
      queryClient.invalidateQueries({ queryKey: ['ipd'] });
      router.push(`/ipd/admissions/${a.id}`);
    },
    onError: (e) => setFormError(errorMessage(e)),
  });

  if (!canAdmit) return <NoAccess />;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setErrors({});
    const amount = advance.amount.trim() === '' ? 0 : Number(advance.amount);
    const body: I.AdmitInput = {
      patientId: patient?.id ?? '',
      bedId,
      doctorId,
      admissionType,
      reason,
      provisionalDiagnosis: diagnosis || undefined,
      isMlc,
      mlcNo: isMlc && mlcNo ? mlcNo : undefined,
      attendantName: attendant.name || undefined,
      attendantRelation: attendant.relation || undefined,
      attendantMobile: attendant.mobile || undefined,
      expectedDischargeDate: expected || undefined,
      advance: canAdvance && advance.amount.trim() !== '' ? { amount, mode: advance.mode, reference: advance.reference || undefined } : undefined,
    };
    if (!patient) return setFormError('Pick the patient to admit');
    const { errors: found } = validate(I.admitSchema, body);
    if (found) {
      setErrors(found);
      return setFormError(found._form ?? 'Please correct the highlighted fields');
    }
    admit.mutate(body);
  }

  return (
    <>
      <PageHeader title="Admit patient" description="Give the patient a bed and an admitting doctor. An advance can be taken now or later from the patient's bill." />
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Patient and doctor</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <PatientPicker value={patient} onChange={setPatient} />
              </div>
              <Field id="doctor" label="Admitting doctor" error={errors.doctorId}>
                <Select id="doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} required>
                  <option value="">Choose…</option>
                  {doctors?.map((d) => (
                    <option key={d.userId} value={d.userId}>
                      {d.name}
                      {d.specialization ? ` · ${d.specialization}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="type" label="Admission type">
                <Select id="type" value={admissionType} onChange={(e) => setAdmissionType(e.target.value as I.AdmissionType)}>
                  {I.ADMISSION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ADMISSION_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="reason" label="Reason for admission" className="sm:col-span-2" error={errors.reason}>
                <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={2} maxLength={1000} rows={2} />
              </Field>
              <Field id="dx" label="Provisional diagnosis (optional)" className="sm:col-span-2">
                <Input id="dx" value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} maxLength={1000} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={isMlc} onChange={(e) => setIsMlc(e.target.checked)} /> Medico-legal case (MLC)
              </label>
              {isMlc && (
                <Field id="mlc" label="MLC / police intimation no." error={errors.mlcNo}>
                  <Input id="mlc" value={mlcNo} onChange={(e) => setMlcNo(e.target.value)} maxLength={50} />
                </Field>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Attendant</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <Field id="att-name" label="Name" error={errors.attendantName}>
                <Input id="att-name" value={attendant.name} onChange={(e) => setAttendant({ ...attendant, name: e.target.value })} maxLength={100} />
              </Field>
              <Field id="att-rel" label="Relation">
                <Input id="att-rel" value={attendant.relation} onChange={(e) => setAttendant({ ...attendant, relation: e.target.value })} maxLength={50} placeholder="Son, wife…" />
              </Field>
              <Field id="att-mob" label="Mobile" error={errors.attendantMobile}>
                <Input id="att-mob" inputMode="numeric" value={attendant.mobile} onChange={(e) => setAttendant({ ...attendant, mobile: e.target.value })} maxLength={14} placeholder="10-digit mobile" />
              </Field>
              <Field id="edd" label="Expected discharge (optional)" error={errors.expectedDischargeDate}>
                <Input id="edd" type="date" min={todayIso()} value={expected} onChange={(e) => setExpected(e.target.value)} />
              </Field>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Bed</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select aria-label="Bed" value={bedId} onChange={(e) => setBedId(e.target.value)} required>
                <option value="">Choose a free bed…</option>
                {board?.wards.map((w) => {
                  const free = freeBeds.filter((b) => b.wardId === w.id);
                  if (!free.length) return null;
                  return (
                    <optgroup key={w.id} label={w.name}>
                      {free.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.code}
                          {b.roomNo ? ` (Rm ${b.roomNo})` : ''} · {formatINR(b.dailyRate)}/day{b.status === 'reserved' ? ' · reserved' : ''}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </Select>
              {errors.bedId && <p className="text-xs text-destructive">Pick a free bed</p>}
              {board && freeBeds.length === 0 && <p className="text-sm text-destructive">No free beds right now.</p>}
              {bed && (
                <p className="text-sm text-muted-foreground">
                  {bed.wardName} · bed {bed.code} at {formatINR(bed.dailyRate)} per day.
                </p>
              )}
            </CardContent>
          </Card>

          {canAdvance && (
            <Card>
              <CardHeader>
                <CardTitle>Advance (optional)</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Field id="adv-amt" label="Amount (₹)" error={errors["advance.amount"]}>
                  <Input id="adv-amt" type="number" min={0} step="0.01" value={advance.amount} onChange={(e) => setAdvance({ ...advance, amount: e.target.value })} />
                </Field>
                <Field id="adv-mode" label="Mode">
                  <Select id="adv-mode" value={advance.mode} onChange={(e) => setAdvance({ ...advance, mode: e.target.value as I.AdvanceMode })}>
                    {I.ADVANCE_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m.toUpperCase()}
                      </option>
                    ))}
                  </Select>
                </Field>
                {advance.mode !== 'cash' && (
                  <Field id="adv-ref" label="Reference / UTR" error={errors["advance.reference"]}>
                    <Input id="adv-ref" value={advance.reference} onChange={(e) => setAdvance({ ...advance, reference: e.target.value })} maxLength={100} />
                  </Field>
                )}
              </CardContent>
            </Card>
          )}

          <ErrorBox error={formError} />
          <Button type="submit" className="w-full" disabled={admit.isPending}>
            {admit.isPending && <Loader2 className="animate-spin" />} Admit
          </Button>
        </div>
      </form>
    </>
  );
}
