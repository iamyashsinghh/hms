'use client';

// Discharge summary editor and the discharge step on the admission page.
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Printer, Trash2 } from 'lucide-react';
import { ipd as I, todayIso } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/validate';
import { usePermission } from '@/lib/auth';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { DISCHARGE_TYPE_LABELS, ErrorBox, Field, Textarea, formatDateTime } from './ui';

type Form = Omit<I.DischargeSummaryInput, 'medications'> & { medications: I.DischargeMedication[] };

const TEXT_FIELDS: [keyof Form, string, number][] = [
  ['presentingComplaints', 'Presenting complaints', 2],
  ['history', 'Relevant history', 2],
  ['examination', 'Examination on admission', 2],
  ['investigations', 'Key investigations', 3],
  ['procedures', 'Procedures / surgery', 2],
  ['hospitalCourse', 'Course in hospital', 4],
  ['conditionAtDischarge', 'Condition at discharge', 1],
  ['advice', 'Advice on discharge (diet, activity, warning signs)', 3],
];

export function DischargeTab({ admission }: { admission: I.Admission }) {
  const id = admission.id;
  const queryClient = useQueryClient();
  const canWrite = usePermission('ipd.summary.write');
  const canSign = usePermission('ipd.summary.finalize');
  const canDischarge = usePermission('ipd.admission.discharge');
  const key = ['ipd', 'summary', id];
  const { data, error } = useQuery({ queryKey: key, queryFn: () => api.ipd.summary.get(id) });
  const summary = data?.summary ?? null;
  const editable = canWrite && admission.status !== 'cancelled' && summary?.status !== 'final';
  const { data: draft } = useQuery({
    queryKey: ['ipd', 'summary-draft', id],
    queryFn: () => api.ipd.summary.draft(id),
    enabled: canWrite && !!data && !data.summary,
  });
  // Start from the saved summary, or from a draft built from the chart.
  const initial: Form | null = summary
    ? {
        finalDiagnosis: summary.finalDiagnosis,
        presentingComplaints: summary.presentingComplaints ?? '',
        history: summary.history ?? '',
        examination: summary.examination ?? '',
        investigations: summary.investigations ?? '',
        procedures: summary.procedures ?? '',
        hospitalCourse: summary.hospitalCourse ?? '',
        conditionAtDischarge: summary.conditionAtDischarge ?? '',
        medications: summary.medications,
        advice: summary.advice ?? '',
        followUpDate: summary.followUpDate ?? '',
        followUpNotes: summary.followUpNotes ?? '',
      }
    : draft
      ? { ...draft, medications: (draft.medications ?? []) as I.DischargeMedication[] }
      : null;
  // Local edits on top of the saved or drafted summary.
  const [edits, setForm] = React.useState<Form | null>(null);
  const form = edits ?? initial;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ['ipd', 'admission', id] });
  };
  const save = useMutation({
    mutationFn: (body: I.DischargeSummaryInput) => api.ipd.summary.save(id, body),
    onSuccess: refresh,
  });
  const sign = useMutation({
    mutationFn: async (body: I.DischargeSummaryInput) => {
      await api.ipd.summary.save(id, body);
      return api.ipd.summary.finalize(id);
    },
    onSuccess: refresh,
  });

  const clean = (f: Form): I.DischargeSummaryInput => {
    const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
    const out = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, blank(v)])) as I.DischargeSummaryInput;
    return { ...out, finalDiagnosis: f.finalDiagnosis, medications: f.medications.filter((m) => m.drugName.trim()) };
  };

  const [errors, setErrors] = React.useState<FieldErrors>({});
  // Follow-up cannot be before the discharge day (or today while the patient is still in).
  const earliestFollowUp = admission.dischargedAt ? new Date(admission.dischargedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : todayIso();
  /** Checks the form like the API does; returns the body to send, or null after showing the errors. */
  const checked = (f: Form): I.DischargeSummaryInput | null => {
    const body = clean(f);
    const { errors: found } = validate(I.dischargeSummaryInputSchema, body);
    const all: FieldErrors = { ...(found ?? {}) };
    if (body.followUpDate && body.followUpDate < earliestFollowUp) {
      all.followUpDate = admission.dischargedAt ? 'Follow-up date cannot be before the discharge date' : 'Follow-up date cannot be in the past';
    }
    setErrors(all);
    return Object.keys(all).length ? null : body;
  };
  const firstFieldError = Object.values(errors)[0] ?? null;

  const err = save.error ?? sign.error ?? error;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader className="flex flex-row items-baseline justify-between">
            <CardTitle>Discharge summary</CardTitle>
            <span className="text-sm text-muted-foreground">
              {summary?.status === 'final'
                ? `Signed by ${summary.finalizedByName ?? 'doctor'} · ${formatDateTime(summary.finalizedAt)}`
                : summary
                  ? `Draft · saved ${formatDateTime(summary.updatedAt)}`
                  : 'Not started'}
            </span>
          </CardHeader>
          <CardContent className="space-y-4">
            <ErrorBox error={firstFieldError ?? (err ? errorMessage(err) : null)} />
            {!form ? (
              <p className="text-sm text-muted-foreground">{canWrite ? 'Loading…' : 'No summary yet.'}</p>
            ) : (
              <fieldset disabled={!editable} className="space-y-4">
                <Field id="s-dx" label="Final diagnosis" error={errors.finalDiagnosis}>
                  <Textarea id="s-dx" rows={2} value={form.finalDiagnosis} onChange={(e) => setForm({ ...form, finalDiagnosis: e.target.value })} maxLength={2000} />
                </Field>
                {TEXT_FIELDS.map(([k, label, rows]) => (
                  <Field key={k} id={`s-${k}`} label={label}>
                    <Textarea id={`s-${k}`} rows={rows} value={(form[k] as string | undefined) ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                  </Field>
                ))}
                <div>
                  <p className="mb-2 text-sm font-medium">Medicines on discharge</p>
                  <div className="space-y-2">
                    {form.medications.map((m, i) => {
                      const setMed = (patch: Partial<I.DischargeMedication>) =>
                        setForm({ ...form, medications: form.medications.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                      return (
                        <div key={i} className="grid grid-cols-12 gap-2">
                          <Input className="col-span-4" aria-label="Drug" placeholder="Drug" value={m.drugName} onChange={(e) => setMed({ drugName: e.target.value })} />
                          <Input className="col-span-2" aria-label="Dose" placeholder="Dose" value={m.dose ?? ''} onChange={(e) => setMed({ dose: e.target.value || undefined })} />
                          <Input className="col-span-2" aria-label="Frequency" placeholder="Freq." value={m.frequency ?? ''} onChange={(e) => setMed({ frequency: e.target.value || undefined })} />
                          <Input
                            className="col-span-1"
                            aria-label="Days"
                            type="number"
                            min={0}
                            max={365}
                            placeholder="Days"
                            value={m.days ?? ''}
                            onChange={(e) => setMed({ days: e.target.value === '' ? undefined : Number(e.target.value) })}
                          />
                          <Input className="col-span-2" aria-label="Instructions" placeholder="After food…" value={m.instructions ?? ''} onChange={(e) => setMed({ instructions: e.target.value || undefined })} />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="col-span-1"
                            aria-label="Remove"
                            onClick={() => setForm({ ...form, medications: form.medications.filter((_, j) => j !== i) })}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      );
                    })}
                    {editable && (
                      <Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, medications: [...form.medications, { drugName: '' }] })}>
                        <Plus /> Add medicine
                      </Button>
                    )}
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field id="s-fu" label="Follow-up date" error={errors.followUpDate}>
                    <Input id="s-fu" type="date" min={earliestFollowUp} value={form.followUpDate ?? ''} onChange={(e) => setForm({ ...form, followUpDate: e.target.value })} />
                  </Field>
                  <Field id="s-fun" label="Follow-up notes" className="sm:col-span-2">
                    <Input id="s-fun" value={form.followUpNotes ?? ''} onChange={(e) => setForm({ ...form, followUpNotes: e.target.value })} maxLength={500} />
                  </Field>
                </div>
              </fieldset>
            )}
            <div className="flex flex-wrap gap-2">
              {editable && form && (
                <Button variant="outline" disabled={save.isPending} onClick={() => {
                    const body = checked(form);
                    if (body) save.mutate(body);
                  }}>
                  {save.isPending && <Loader2 className="animate-spin" />} Save draft
                </Button>
              )}
              {editable && canSign && form && (
                <Button
                  disabled={sign.isPending || form.finalDiagnosis.trim().length < 2}
                  onClick={() => {
                    const body = checked(form);
                    if (body && window.confirm('Sign the discharge summary? It cannot be edited after signing.')) sign.mutate(body);
                  }}
                >
                  {sign.isPending && <Loader2 className="animate-spin" />} Sign summary
                </Button>
              )}
              {summary && (
                <Link href={`/ipd/admissions/${id}/summary`} className={buttonVariants({ variant: 'ghost' })}>
                  <Printer /> Print
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        {admission.status === 'admitted' && canDischarge && <DischargeCard admission={admission} summaryFinal={summary?.status === 'final'} />}
        {admission.status === 'discharged' && (
          <Card>
            <CardContent className="space-y-1 pt-6 text-sm">
              <p className="font-medium">Discharged {formatDateTime(admission.dischargedAt)}</p>
              <p className="text-muted-foreground">{admission.dischargeType ? DISCHARGE_TYPE_LABELS[admission.dischargeType] : ''}</p>
              {admission.dischargeNotes && <p>{admission.dischargeNotes}</p>}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function DischargeCard({ admission, summaryFinal }: { admission: I.Admission; summaryFinal: boolean }) {
  const queryClient = useQueryClient();
  const [type, setType] = React.useState<I.DischargeType>('normal');
  const [notes, setNotes] = React.useState('');
  const [allowDue, setAllowDue] = React.useState(false);
  const discharge = useMutation({
    mutationFn: (body: I.DischargeInput) => api.ipd.admissions.discharge(admission.id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ipd'] }),
  });
  const billFinal = !!admission.invoiceId;
  const blocked = !billFinal || (!summaryFinal && type !== 'absconded');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Discharge</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <ul className="space-y-1">
          <li>{billFinal ? '✓' : '○'} Bill finalized</li>
          <li>{summaryFinal ? '✓' : '○'} Discharge summary signed</li>
        </ul>
        <Field id="d-type" label="Discharge type">
          <Select id="d-type" value={type} onChange={(e) => setType(e.target.value as I.DischargeType)}>
            {I.DISCHARGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {DISCHARGE_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="d-notes" label="Notes">
          <Textarea id="d-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
        </Field>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={allowDue} onChange={(e) => setAllowDue(e.target.checked)} /> Allow discharge with money due (needs a note)
        </label>
        <ErrorBox error={discharge.error ? errorMessage(discharge.error) : null} />
        <Button
          disabled={blocked || discharge.isPending}
          onClick={() => window.confirm('Discharge this patient and free the bed?') && discharge.mutate({ dischargeType: type, notes: notes || undefined, allowDue })}
        >
          {discharge.isPending && <Loader2 className="animate-spin" />} Discharge patient
        </Button>
      </CardContent>
    </Card>
  );
}
