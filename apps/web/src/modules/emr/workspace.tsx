'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Plus, Save, Star, Trash2, X } from 'lucide-react';
import { emr as E, todayIso, type billing, type emr } from '@hms/shared';
import { api, ApiError, errorMessage } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/validate';
import { usePermission } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatINR, useDebounced } from '@/modules/billing/ui';
import { Textarea, TIMING_LABEL, formatTime, vitalsLine } from './ui';

type Enc = emr.Encounter;

/** Mutation that replaces the cached encounter with the server's answer. */
function useEncounterMutation<V>(id: string, fn: (v: V) => Promise<Enc>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (enc) => {
      qc.setQueryData(['emr', 'encounter', id], enc);
      qc.invalidateQueries({ queryKey: ['emr', 'queue'] });
    },
  });
}

function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
}

function SectionCard({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        {actions && <div className="flex gap-2">{actions}</div>}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

const numOrUndef = (v: string) => (v.trim() === '' ? undefined : Number(v));

function FieldMsg({ msg }: { msg?: string }) {
  return msg ? <p className="mt-1 text-xs text-destructive">{msg}</p> : null;
}

// ---------- vitals ----------

const VITAL_FIELDS: { key: keyof emr.VitalsInput; label: string; step?: string }[] = [
  { key: 'bpSystolic', label: 'BP sys' },
  { key: 'bpDiastolic', label: 'BP dia' },
  { key: 'pulse', label: 'Pulse' },
  { key: 'temperatureC', label: 'Temp °C', step: '0.1' },
  { key: 'spo2', label: 'SpO₂ %' },
  { key: 'respRate', label: 'Resp rate' },
  { key: 'weightKg', label: 'Weight kg', step: '0.1' },
  { key: 'heightCm', label: 'Height cm', step: '0.1' },
  { key: 'bloodSugar', label: 'RBS mg/dL' },
  { key: 'painScore', label: 'Pain 0-10' },
];

export function VitalsCard({ enc, editable }: { enc: Enc; editable: boolean }) {
  const canWrite = usePermission('emr.vitals.write');
  const [form, setForm] = React.useState<Record<string, string>>({});
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const save = useEncounterMutation(enc.id, (body: emr.VitalsInput) => api.emr.addVitals(enc.id, body));
  const latest = enc.vitals.at(-1);

  const submit = () => {
    const body: Record<string, number> = {};
    for (const f of VITAL_FIELDS) {
      const n = numOrUndef(form[f.key] ?? '');
      if (n !== undefined) body[f.key] = n;
    }
    const checked = validate(E.vitalsInputSchema, body);
    if (checked.errors) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    save.mutate(checked.data, { onSuccess: () => setForm({}) });
  };

  return (
    <SectionCard title="Vitals">
      {latest ? (
        <p className="text-sm">
          {vitalsLine(latest)} <span className="text-xs text-muted-foreground">at {formatTime(latest.recordedAt)}</span>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">No vitals recorded yet.</p>
      )}
      {editable && canWrite && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {VITAL_FIELDS.map((f) => (
              <div key={f.key}>
                <Label htmlFor={`v-${f.key}`} className="text-xs text-muted-foreground">
                  {f.label}
                </Label>
                <Input
                  id={`v-${f.key}`}
                  type="number"
                  step={f.step ?? '1'}
                  min={E.VITAL_LIMITS[f.key as keyof typeof E.VITAL_LIMITS][0]}
                  max={E.VITAL_LIMITS[f.key as keyof typeof E.VITAL_LIMITS][1]}
                  inputMode="decimal"
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  aria-invalid={!!errors[f.key]}
                  className="mt-1"
                />
                <FieldMsg msg={errors[f.key]} />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" onClick={submit} disabled={save.isPending}>
              <Plus /> Add reading
            </Button>
            {errors._form && <p className="text-sm text-destructive">{errors._form}</p>}
            <ErrorLine error={save.error} />
          </div>
        </>
      )}
    </SectionCard>
  );
}

// ---------- notes ----------

const NOTE_FIELDS: { key: keyof emr.EncounterNotes; label: string; rows?: number }[] = [
  { key: 'chiefComplaints', label: 'Chief complaints', rows: 2 },
  { key: 'historyOfPresentIllness', label: 'History of present illness', rows: 3 },
  { key: 'pastHistory', label: 'Past / medication history', rows: 2 },
  { key: 'familyHistory', label: 'Family history', rows: 1 },
  { key: 'examination', label: 'Examination findings', rows: 3 },
  { key: 'advice', label: 'Advice (printed on Rx)', rows: 2 },
  { key: 'privateNotes', label: 'Private notes (not printed)', rows: 2 },
];

export function NotesCard({ enc, editable }: { enc: Enc; editable: boolean }) {
  const [notes, setNotes] = React.useState<emr.EncounterNotes>(enc.notes);
  const [followUpDate, setFollowUpDate] = React.useState(enc.followUpDate ?? '');
  const [followUpNotes, setFollowUpNotes] = React.useState(enc.followUpNotes ?? '');
  const save = useEncounterMutation(enc.id, (body: emr.UpdateEncounter) => api.emr.update(enc.id, body));
  // A new or changed follow-up date must be today or later (an old one may stay as it is).
  const followUpError =
    followUpDate && followUpDate !== (enc.followUpDate ?? '') && followUpDate < todayIso() ? 'Follow-up date cannot be in the past' : null;
  const dirty =
    JSON.stringify(notes) !== JSON.stringify(enc.notes) || followUpDate !== (enc.followUpDate ?? '') || followUpNotes !== (enc.followUpNotes ?? '');

  if (!editable) {
    return (
      <SectionCard title="Clinical notes">
        {NOTE_FIELDS.filter((f) => enc.notes[f.key]).map((f) => (
          <div key={f.key}>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{f.label}</div>
            <p className="mt-1 whitespace-pre-wrap text-sm">{enc.notes[f.key]}</p>
          </div>
        ))}
        {enc.followUpDate && (
          <p className="text-sm">
            <span className="font-medium">Follow-up:</span> {enc.followUpDate} {enc.followUpNotes}
          </p>
        )}
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Clinical notes"
      actions={
        <Button
          size="sm"
          disabled={!dirty || save.isPending || !!followUpError}
          onClick={() => {
            const allNotes = Object.fromEntries(NOTE_FIELDS.map((f) => [f.key, notes[f.key] ?? ''])) as emr.EncounterNotes;
            save.mutate({ notes: allNotes, followUpDate: followUpDate || null, followUpNotes: followUpNotes || null });
          }}
        >
          {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save notes
        </Button>
      }
    >
      {NOTE_FIELDS.map((f) => (
        <div key={f.key}>
          <Label htmlFor={`n-${f.key}`}>{f.label}</Label>
          <Textarea
            id={`n-${f.key}`}
            rows={f.rows}
            className="mt-1.5 min-h-0"
            value={notes[f.key] ?? ''}
            onChange={(e) => setNotes((n) => ({ ...n, [f.key]: e.target.value }))}
          />
        </div>
      ))}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="fu-date">Follow-up date</Label>
          <Input
            id="fu-date"
            type="date"
            className="mt-1.5"
            min={todayIso()}
            value={followUpDate}
            aria-invalid={!!followUpError}
            onChange={(e) => setFollowUpDate(e.target.value)}
          />
          <FieldMsg msg={followUpError ?? undefined} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="fu-notes">Follow-up instructions</Label>
          <Input id="fu-notes" className="mt-1.5" maxLength={1000} value={followUpNotes} onChange={(e) => setFollowUpNotes(e.target.value)} />
        </div>
      </div>
      <ErrorLine error={save.error} />
    </SectionCard>
  );
}

// ---------- diagnoses ----------

type DiagnosisDraft = { icd10Code?: string; description: string; kind: 'provisional' | 'final'; isPrimary: boolean };

export function DiagnosesCard({ enc, editable }: { enc: Enc; editable: boolean }) {
  const [rows, setRows] = React.useState<DiagnosisDraft[]>(() =>
    enc.diagnoses.map((d) => ({ icd10Code: d.icd10Code ?? undefined, description: d.description, kind: d.kind, isPrimary: d.isPrimary })),
  );
  const [q, setQ] = React.useState('');
  const [free, setFree] = React.useState('');
  const term = q.trim();
  const { data: hits } = useQuery({ queryKey: ['emr', 'icd10', term], queryFn: () => api.emr.icd10(term), enabled: editable && term.length >= 2 });
  const save = useEncounterMutation(enc.id, (body: emr.DiagnosesInput) => api.emr.setDiagnoses(enc.id, body));
  const dirty = JSON.stringify(rows) !== JSON.stringify(enc.diagnoses.map((d) => ({ icd10Code: d.icd10Code ?? undefined, description: d.description, kind: d.kind, isPrimary: d.isPrimary })));

  const add = (d: Omit<DiagnosisDraft, 'kind' | 'isPrimary'>) => {
    setRows((r) => [...r, { ...d, kind: 'provisional', isPrimary: r.length === 0 }]);
    setQ('');
    setFree('');
  };

  return (
    <SectionCard
      title="Diagnosis"
      actions={
        editable && (
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate({ diagnoses: rows })}>
            <Save /> Save
          </Button>
        )
      }
    >
      {rows.length === 0 && <p className="text-sm text-muted-foreground">No diagnosis yet.</p>}
      <ul className="space-y-2">
        {rows.map((d, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
            {d.icd10Code && <Badge variant="outline" className="font-mono">{d.icd10Code}</Badge>}
            <span className="font-medium">{d.description}</span>
            {d.isPrimary && <Badge>Primary</Badge>}
            {editable ? (
              <>
                <Select
                  className="h-7 w-auto text-xs"
                  value={d.kind}
                  onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, kind: e.target.value as DiagnosisDraft['kind'] } : x)))}
                >
                  <option value="provisional">Provisional</option>
                  <option value="final">Final</option>
                </Select>
                {!d.isPrimary && (
                  <Button size="sm" variant="ghost" onClick={() => setRows((r) => r.map((x, j) => ({ ...x, isPrimary: j === i })))}>
                    Make primary
                  </Button>
                )}
                <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
                  <X />
                </Button>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">{d.kind}</span>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="relative">
            <Input placeholder="Search ICD-10 (e.g. fever, J06)" value={q} onChange={(e) => setQ(e.target.value)} />
            {term.length >= 2 && hits && hits.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-card shadow-lg">
                {hits.map((h) => (
                  <li key={h.code}>
                    <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => add({ icd10Code: h.code, description: h.description })}>
                      <span className="font-mono text-xs text-muted-foreground">{h.code}</span> {h.description}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (free.trim()) add({ description: free.trim() });
            }}
          >
            <Input placeholder="Or type a diagnosis" maxLength={300} value={free} onChange={(e) => setFree(e.target.value)} />
            <Button type="submit" variant="outline" size="icon" aria-label="Add">
              <Plus />
            </Button>
          </form>
        </div>
      )}
      <ErrorLine error={save.error} />
    </SectionCard>
  );
}

// ---------- prescription ----------

type LineDraft = emr.PrescriptionLineInput & { _key: number; _qtyTouched?: boolean };
let keySeq = 0;
const blankLine = (): LineDraft => ({ _key: ++keySeq, drugName: '', dose: '1 tab', frequency: 'BD', days: 5, route: 'oral', timing: 'after_food' });
const toDraft = (l: Partial<emr.PrescriptionLineInput> & Pick<emr.PrescriptionLineInput, 'drugName' | 'dose' | 'frequency'>): LineDraft => ({
  _key: ++keySeq,
  drugName: l.drugName,
  genericName: l.genericName ?? undefined,
  strength: l.strength ?? undefined,
  form: l.form ?? undefined,
  itemCode: l.itemCode ?? undefined,
  dose: l.dose,
  route: (l.route as LineDraft['route']) ?? 'oral',
  frequency: l.frequency,
  timing: (l.timing as LineDraft['timing']) ?? undefined,
  days: l.days ?? undefined,
  qty: l.qty ?? undefined,
  instructions: l.instructions ?? undefined,
  allergyOverrideReason: l.allergyOverrideReason ?? undefined,
  _qtyTouched: l.qty != null,
});

function stripDraft(l: LineDraft): emr.PrescriptionLineInput {
  return Object.fromEntries(
    Object.entries(l).filter(([k, v]) => !k.startsWith('_') && v !== '' && v !== undefined && v !== null),
  ) as emr.PrescriptionLineInput;
}

export function PrescriptionCard({ enc, editable }: { enc: Enc; editable: boolean }) {
  const canWrite = usePermission('emr.prescription.write');
  const editing = editable && canWrite;
  const initial = React.useMemo(() => (enc.prescription?.lines ?? []).map((l) => toDraft(l as never)), [enc.prescription]);
  const [lines, setLines] = React.useState<LineDraft[]>(initial);
  const [notes, setNotes] = React.useState(enc.prescription?.notes ?? '');
  const [conflicts, setConflicts] = React.useState<emr.AllergyConflict[]>([]);
  /** Errors by displayed line index ("3.dose") plus "notes" / "_form". */
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const save = useEncounterMutation(enc.id, (body: emr.PrescriptionInput) => api.emr.setPrescription(enc.id, body));
  const qc = useQueryClient();
  const { data: favourites } = useQuery({ queryKey: ['emr', 'favourites'], queryFn: () => api.emr.favourites(), enabled: editing });
  const saveFav = useMutation({
    mutationFn: (body: emr.FavouriteInput) => api.emr.createFavourite(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['emr', 'favourites'] }),
  });

  const set = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) =>
      ls.map((l, j) => {
        if (j !== i) return l;
        const next = { ...l, ...patch };
        if (!next._qtyTouched && ('frequency' in patch || 'days' in patch)) next.qty = E.suggestQty(next.frequency, next.days) ?? undefined;
        return next;
      }),
    );

  const submit = () => {
    setConflicts([]);
    // Lines with no medicine name are dropped; keep their screen positions to show errors on the right line.
    const kept = lines.map((l, i) => [l, i] as const).filter(([l]) => l.drugName.trim());
    const checked = validate(E.prescriptionInputSchema, { lines: kept.map(([l]) => stripDraft(l)), notes: notes || undefined });
    if (checked.errors) {
      const mapped: FieldErrors = {};
      for (const [key, msg] of Object.entries(checked.errors)) {
        const m = /^lines\.(\d+)\.(.+)$/.exec(key);
        mapped[m ? `${kept[Number(m[1])]?.[1]}.${m[2]}` : key] ??= msg;
      }
      setErrors(mapped);
      return;
    }
    setErrors({});
    save.mutate(checked.data, {
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'allergy_conflict') {
          setConflicts((err.details as { conflicts: emr.AllergyConflict[] }).conflicts);
        }
      },
    });
  };

  if (!editing) {
    const rx = enc.prescription;
    return (
      <SectionCard title={rx ? `Prescription · ${rx.rxNo}` : 'Prescription'}>
        {!rx ? (
          <p className="text-sm text-muted-foreground">No medicines prescribed.</p>
        ) : (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            {rx.lines.map((l) => (
              <li key={l.id}>
                <span className="font-medium">{l.drugName}</span> {l.strength} — {l.dose} {l.frequency}
                {l.days ? ` × ${l.days} days` : ''} {l.timing ? `(${TIMING_LABEL[l.timing]})` : ''} {l.qty ? `· Qty ${l.qty}` : ''}
                {l.instructions && <div className="text-xs text-muted-foreground">{l.instructions}</div>}
              </li>
            ))}
          </ol>
        )}
      </SectionCard>
    );
  }

  const allergies = enc.patient.allergies.filter((a) => !/^(nkda|none|nil)$/i.test(a));

  return (
    <SectionCard
      title={enc.prescription ? `Prescription · ${enc.prescription.rxNo}` : 'Prescription'}
      actions={
        <>
          {favourites && favourites.length > 0 && (
            <Select
              className="h-8 w-44 text-xs"
              value=""
              onChange={(e) => {
                const fav = favourites.find((f) => f.id === e.target.value);
                if (fav) setLines((ls) => [...ls.filter((l) => l.drugName.trim()), ...fav.lines.map((l) => toDraft(l))]);
              }}
            >
              <option value="">+ Add favourite…</option>
              {favourites.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          )}
          <Button size="sm" disabled={save.isPending} onClick={submit}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save Rx
          </Button>
        </>
      }
    >
      {allergies.length > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4" /> Allergies: {allergies.join(', ')}
        </div>
      )}
      <div className="space-y-3">
        {lines.map((l, i) => {
          const conflict = conflicts.find((c) => c.line === i);
          const lineErrors = Object.entries(errors)
            .filter(([k]) => k.startsWith(`${i}.`))
            .map(([, m]) => m);
          return (
            <div key={l._key} className={`rounded-md border p-3 ${conflict ? 'border-destructive' : ''}`}>
              <div className="grid gap-2 sm:grid-cols-12">
                <Input className="sm:col-span-4" placeholder="Medicine (brand / generic + strength)" maxLength={200} value={l.drugName} onChange={(e) => set(i, { drugName: e.target.value })} />
                <Input className="sm:col-span-2" placeholder="Dose" maxLength={50} aria-invalid={!!errors[`${i}.dose`]} value={l.dose} onChange={(e) => set(i, { dose: e.target.value })} />
                <Input
                  className="sm:col-span-2"
                  list="emr-frequencies"
                  placeholder="1-0-1 / BD"
                  maxLength={30}
                  aria-invalid={!!errors[`${i}.frequency`]}
                  value={l.frequency}
                  onChange={(e) => set(i, { frequency: e.target.value })}
                />
                <Input className="sm:col-span-1" type="number" min={0} max={365} step={1} placeholder="Days" aria-invalid={!!errors[`${i}.days`]} value={l.days ?? ''} onChange={(e) => set(i, { days: numOrUndef(e.target.value) })} />
                <Input
                  className="sm:col-span-1"
                  type="number"
                  min={0}
                  max={10000}
                  placeholder="Qty"
                  aria-invalid={!!errors[`${i}.qty`]}
                  value={l.qty ?? ''}
                  onChange={(e) => set(i, { qty: numOrUndef(e.target.value), _qtyTouched: e.target.value !== '' })}
                />
                <Button className="sm:col-span-2" variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                  <Trash2 /> Remove
                </Button>
                <Select className="sm:col-span-3" value={l.timing ?? 'any'} onChange={(e) => set(i, { timing: e.target.value as LineDraft['timing'] })}>
                  {E.DRUG_TIMINGS.map((t) => (
                    <option key={t} value={t}>
                      {TIMING_LABEL[t] || 'Any time'}
                    </option>
                  ))}
                </Select>
                <Select className="sm:col-span-2" value={l.route ?? 'oral'} onChange={(e) => set(i, { route: e.target.value as LineDraft['route'] })}>
                  {E.DRUG_ROUTES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
                <Input className="sm:col-span-7" placeholder="Instructions" maxLength={500} value={l.instructions ?? ''} onChange={(e) => set(i, { instructions: e.target.value })} />
              </div>
              {lineErrors.length > 0 && <p className="mt-2 text-xs text-destructive">{lineErrors.join(' · ')}</p>}
              {(conflict || l.allergyOverrideReason !== undefined) && (
                <div className="mt-2 space-y-1">
                  {conflict && (
                    <p className="flex items-center gap-1 text-sm text-destructive">
                      <AlertTriangle className="size-4" /> Patient is allergic to {conflict.allergy}. Change the medicine or give a reason to prescribe anyway.
                    </p>
                  )}
                  <Input
                    placeholder="Reason to prescribe despite allergy (at least 3 characters)"
                    maxLength={300}
                    value={l.allergyOverrideReason ?? ''}
                    onChange={(e) => set(i, { allergyOverrideReason: e.target.value })}
                  />
                </div>
              )}
            </div>
          );
        })}
        <datalist id="emr-frequencies">
          {['1-0-0', '0-0-1', '1-0-1', '1-1-1', '1-1-1-1', ...Object.keys(E.FREQUENCIES)].map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine()])}>
          <Plus /> Add medicine
        </Button>
        {lines.some((l) => l.drugName.trim()) && (
          <Button
            size="sm"
            variant="ghost"
            disabled={saveFav.isPending}
            onClick={() => {
              const name = window.prompt('Save these medicines as a favourite named:');
              if (name?.trim()) {
                saveFav.mutate({
                  name: name.trim(),
                  lines: lines.filter((l) => l.drugName.trim()).map((l) => ({ ...stripDraft(l), allergyOverrideReason: undefined })),
                });
              }
            }}
          >
            <Star /> Save as favourite
          </Button>
        )}
        {saveFav.isSuccess && <span className="self-center text-xs text-muted-foreground">Favourite saved</span>}
      </div>
      <div>
        <Label htmlFor="rx-notes">Rx notes</Label>
        <Input id="rx-notes" className="mt-1.5" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <FieldMsg msg={errors.notes} />
      </div>
      {errors._form && <p className="text-sm text-destructive">{errors._form}</p>}
      {errors.lines && <p className="text-sm text-destructive">{errors.lines}</p>}
      {save.error && !conflicts.length ? <ErrorLine error={save.error} /> : null}
      {saveFav.error ? <ErrorLine error={saveFav.error} /> : null}
    </SectionCard>
  );
}

// ---------- orders ----------

type OrderDraft = { kind: emr.OrderInput['kind']; name: string; priority: 'routine' | 'urgent' };

const toInput = (o: emr.Order): emr.OrderInput => ({
  kind: o.kind,
  name: o.name,
  code: o.code ?? undefined,
  serviceCode: o.serviceCode ?? undefined,
  priority: o.priority,
  notes: o.notes ?? undefined,
});

/** Procedure search over the billing service master (category "procedure"), so the procedure has a price. */
function ProcedureSearch({ value, onChange, onPick }: { value: string; onChange: (v: string) => void; onPick: (s: billing.Service) => void }) {
  const canSearch = usePermission('billing.service.read');
  const term = useDebounced(value.trim(), 250);
  const { data } = useQuery({
    queryKey: ['billing', 'services', 'procedure', term],
    queryFn: () => api.billing.services.list({ category: 'procedure', q: term, active: 'true', pageSize: 10 }),
    enabled: canSearch && term.length >= 2,
    staleTime: 60_000,
  });
  const hits = term.length >= 2 ? (data?.items ?? []) : [];
  return (
    <div className="relative sm:col-span-4">
      <Input placeholder="Search procedures (e.g. dressing)" maxLength={200} value={value} onChange={(e) => onChange(e.target.value)} />
      {hits.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-card shadow-lg">
          {hits.map((s) => (
            <li key={s.id}>
              <button type="button" className="flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onPick(s)}>
                <span>
                  {s.name} <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
                </span>
                <span className="tabular-nums text-muted-foreground">{formatINR(s.basePrice)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function OrdersCard({ enc, editable }: { enc: Enc; editable: boolean }) {
  const [rows, setRows] = React.useState<emr.OrderInput[]>(() => enc.orders.map(toInput));
  const [draft, setDraft] = React.useState<OrderDraft>({ kind: 'lab', name: '', priority: 'routine' });
  const save = useEncounterMutation(enc.id, (body: emr.OrdersInput) => api.emr.setOrders(enc.id, body));
  const cancel = useEncounterMutation(enc.id, ({ orderId, reason }: { orderId: string; reason: string }) => api.emr.cancelOrder(enc.id, orderId, { reason }));
  const canWrite = usePermission('emr.encounter.write');
  const dirty =
    rows.length !== enc.orders.length ||
    rows.some((r, i) => r.name !== enc.orders[i]?.name || r.priority !== enc.orders[i]?.priority || (r.serviceCode ?? null) !== enc.orders[i]?.serviceCode);
  const add = (row: emr.OrderInput) => {
    setRows((r) => [...r, row]);
    setDraft((d) => ({ ...d, name: '' }));
  };
  // Once signed the orders are fixed; show the server's copy with each line's progress.
  const shown: (emr.OrderInput & { id?: string; status?: string })[] = editable ? rows : enc.orders.map((o) => ({ ...toInput(o), id: o.id, status: o.status }));

  return (
    <SectionCard
      title="Investigations & procedures"
      actions={
        editable && (
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate({ orders: rows })}>
            <Save /> Save
          </Button>
        )
      }
    >
      {shown.length === 0 && <p className="text-sm text-muted-foreground">No orders.</p>}
      <ul className="space-y-1.5 text-sm">
        {shown.map((o, i) => (
          <li key={o.id ?? i} className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{o.kind}</Badge>
            <span className={o.status === 'cancelled' ? 'line-through' : undefined}>{o.name}</span>
            {o.serviceCode && <span className="font-mono text-xs text-muted-foreground">{o.serviceCode}</span>}
            {o.kind === 'procedure' && !o.serviceCode && <span className="text-xs text-muted-foreground">(not in the service list, not charged)</span>}
            {o.priority === 'urgent' && <Badge variant="destructive">Urgent</Badge>}
            {o.status && o.status !== 'ordered' && <Badge variant="outline">{o.status.replace('_', ' ')}</Badge>}
            {editable && (
              <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
                <X />
              </Button>
            )}
            {!editable && enc.status === 'completed' && canWrite && o.id && o.kind === 'procedure' && o.status === 'ordered' && (
              <Button
                size="sm"
                variant="ghost"
                disabled={cancel.isPending}
                onClick={() => {
                  const reason = window.prompt('Why is this procedure not being done?');
                  if (reason === null) return;
                  if (reason.trim().length >= 3) cancel.mutate({ orderId: o.id!, reason: reason.trim() });
                  else window.alert('Give a reason of at least 3 characters');
                }}
              >
                Cancel
              </Button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <form
          className="grid gap-2 sm:grid-cols-12"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.name.trim()) return;
            add({ ...draft, name: draft.name.trim() });
          }}
        >
          <Select className="sm:col-span-3" value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as typeof d.kind }))}>
            {E.ORDER_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
          {draft.kind === 'procedure' ? (
            <ProcedureSearch
              value={draft.name}
              onChange={(name) => setDraft((d) => ({ ...d, name }))}
              onPick={(s) => add({ kind: 'procedure', name: s.name, serviceCode: s.code, priority: draft.priority })}
            />
          ) : (
            <Input className="sm:col-span-4" placeholder="Test / scan (e.g. CBC)" maxLength={200} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          )}
          <Select className="sm:col-span-3" value={draft.priority} onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value as 'routine' | 'urgent' }))}>
            <option value="routine">Routine</option>
            <option value="urgent">Urgent</option>
          </Select>
          <Button type="submit" variant="outline" className="sm:col-span-2">
            <Plus /> Add
          </Button>
        </form>
      )}
      <ErrorLine error={save.error ?? cancel.error} />
    </SectionCard>
  );
}

// ---------- addenda ----------

export function AddendaCard({ enc }: { enc: Enc }) {
  const canWrite = usePermission('emr.encounter.write');
  const [text, setText] = React.useState('');
  const save = useEncounterMutation(enc.id, (body: emr.AddendumInput) => api.emr.addAddendum(enc.id, body));
  if (!enc.addenda.length && !canWrite) return null;
  return (
    <SectionCard title="Addenda">
      {enc.addenda.map((a) => (
        <div key={a.id} className="rounded-md bg-muted/50 p-3 text-sm">
          <p className="whitespace-pre-wrap">{a.text}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {a.createdByName ?? 'Staff'} · {new Date(a.createdAt).toLocaleString('en-IN')}
          </p>
        </div>
      ))}
      {canWrite && (
        <>
          <Textarea rows={2} maxLength={4000} placeholder="Add a correction or later finding. Signed notes cannot be edited." value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" disabled={!text.trim() || save.isPending} onClick={() => save.mutate({ text: text.trim() }, { onSuccess: () => setText('') })}>
              <Plus /> Add addendum
            </Button>
            <ErrorLine error={save.error} />
          </div>
        </>
      )}
    </SectionCard>
  );
}
