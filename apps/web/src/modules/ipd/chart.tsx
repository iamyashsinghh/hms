'use client';

// Nursing chart and doctor tabs on the admission page: vitals, notes, intake/output, MAR, rounds.
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { ipd as I } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorBox, Field, IO_LABELS, ROUTE_LABELS, Textarea, formatDateTime } from './ui';

type Props = { admissionId: string; active: boolean };

function useSave<T, R>(key: unknown[], fn: (body: T) => Promise<R>, onDone?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      onDone?.();
    },
  });
}

const dash = (v: number | null | undefined, unit = '') => (v == null ? '—' : `${v}${unit}`);

// ---------- vitals ----------

export function VitalsTab({ admissionId, active }: Props) {
  const key = ['ipd', 'vitals', admissionId];
  const { data, error } = useQuery({ queryKey: key, queryFn: () => api.ipd.vitals.list(admissionId) });
  const empty = { temperatureC: '', pulse: '', respRate: '', bpSystolic: '', bpDiastolic: '', spo2: '', painScore: '', bloodSugar: '', notes: '' };
  const [form, setForm] = React.useState(empty);
  const save = useSave(key, (body: I.VitalsInput) => api.ipd.vitals.record(admissionId, body), () => setForm(empty));
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const numOrUndef = (v: string) => (v === '' ? undefined : Number(v));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    save.mutate({
      temperatureC: numOrUndef(form.temperatureC),
      pulse: numOrUndef(form.pulse),
      respRate: numOrUndef(form.respRate),
      bpSystolic: numOrUndef(form.bpSystolic),
      bpDiastolic: numOrUndef(form.bpDiastolic),
      spo2: numOrUndef(form.spo2),
      painScore: numOrUndef(form.painScore),
      bloodSugar: numOrUndef(form.bloodSugar),
      notes: form.notes || undefined,
    });
  }

  const fields: [keyof typeof empty, string, string][] = [
    ['temperatureC', 'Temp (°C)', '0.1'],
    ['pulse', 'Pulse (/min)', '1'],
    ['respRate', 'Resp. rate', '1'],
    ['bpSystolic', 'BP systolic', '1'],
    ['bpDiastolic', 'BP diastolic', '1'],
    ['spo2', 'SpO₂ (%)', '1'],
    ['painScore', 'Pain (0–10)', '1'],
    ['bloodSugar', 'Blood sugar (mg/dL)', '0.1'],
  ];

  return (
    <div className="space-y-6">
      {active && (
        <Can permission="ipd.nursing.write">
          <Card>
            <CardHeader>
              <CardTitle>Record vitals</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="grid gap-3 sm:grid-cols-4">
                {fields.map(([k, label, step]) => (
                  <Field key={k} id={`v-${k}`} label={label}>
                    <Input id={`v-${k}`} type="number" step={step} inputMode="decimal" value={form[k]} onChange={set(k)} />
                  </Field>
                ))}
                <Field id="v-notes" label="Notes" className="sm:col-span-3">
                  <Input id="v-notes" value={form.notes} onChange={set('notes')} maxLength={500} />
                </Field>
                <div className="flex items-end">
                  <Button type="submit" className="w-full" disabled={save.isPending}>
                    {save.isPending && <Loader2 className="animate-spin" />} Save
                  </Button>
                </div>
                <div className="sm:col-span-4">
                  <ErrorBox error={save.error ? errorMessage(save.error) : null} />
                </div>
              </form>
            </CardContent>
          </Card>
        </Can>
      )}
      <ErrorBox error={error ? errorMessage(error) : null} />
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Time</TableHead>
              <TableHead>Temp</TableHead>
              <TableHead>Pulse</TableHead>
              <TableHead>RR</TableHead>
              <TableHead>BP</TableHead>
              <TableHead>SpO₂</TableHead>
              <TableHead>Pain</TableHead>
              <TableHead>Sugar</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data?.length ? (
              <TableRow>
                <TableCell colSpan={9} className="py-6 text-center text-muted-foreground">
                  No vitals recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              data.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(v.recordedAt)}</TableCell>
                  <TableCell className={v.temperatureC != null && v.temperatureC >= 38 ? 'font-medium text-destructive' : ''}>{dash(v.temperatureC, '°')}</TableCell>
                  <TableCell>{dash(v.pulse)}</TableCell>
                  <TableCell>{dash(v.respRate)}</TableCell>
                  <TableCell>{v.bpSystolic != null ? `${v.bpSystolic}/${v.bpDiastolic ?? '—'}` : '—'}</TableCell>
                  <TableCell className={v.spo2 != null && v.spo2 < 94 ? 'font-medium text-destructive' : ''}>{dash(v.spo2, '%')}</TableCell>
                  <TableCell>{dash(v.painScore)}</TableCell>
                  <TableCell>{dash(v.bloodSugar)}</TableCell>
                  <TableCell className="max-w-48 truncate" title={v.notes ?? ''}>
                    {v.notes ?? ''}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// ---------- nursing notes ----------

export function NotesTab({ admissionId, active }: Props) {
  const key = ['ipd', 'notes', admissionId];
  const { data, error } = useQuery({ queryKey: key, queryFn: () => api.ipd.notes.list(admissionId) });
  const [note, setNote] = React.useState('');
  const [shift, setShift] = React.useState<I.NursingShift | ''>('');
  const save = useSave(key, (body: I.NursingNoteInput) => api.ipd.notes.add(admissionId, body), () => setNote(''));

  return (
    <div className="space-y-6">
      {active && (
        <Can permission="ipd.nursing.write">
          <Card>
            <CardContent className="space-y-3 pt-6">
              <Textarea aria-label="Nursing note" placeholder="Write a nursing note…" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={4000} />
              <div className="flex gap-2">
                <Select aria-label="Shift" className="w-40" value={shift} onChange={(e) => setShift(e.target.value as I.NursingShift | '')}>
                  <option value="">Shift…</option>
                  {I.NURSING_SHIFTS.map((s) => (
                    <option key={s} value={s}>
                      {s[0]!.toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </Select>
                <Button disabled={save.isPending || note.trim().length < 2} onClick={() => save.mutate({ note, shift: shift || undefined })}>
                  Add note
                </Button>
              </div>
              <ErrorBox error={save.error ? errorMessage(save.error) : null} />
            </CardContent>
          </Card>
        </Can>
      )}
      <ErrorBox error={error ? errorMessage(error) : null} />
      {!data?.length ? (
        <p className="text-sm text-muted-foreground">No nursing notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {data.map((n) => (
            <li key={n.id} className="rounded-lg border bg-card p-4">
              <p className="mb-1 text-xs text-muted-foreground">
                {formatDateTime(n.createdAt)} · {n.recordedByName ?? 'Staff'}
                {n.shift ? ` · ${n.shift} shift` : ''}
              </p>
              <p className="whitespace-pre-wrap text-sm">{n.note}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- intake / output ----------

export function IntakeOutputTab({ admissionId, active }: Props) {
  const key = ['ipd', 'io', admissionId];
  const { data, error } = useQuery({ queryKey: key, queryFn: () => api.ipd.intakeOutput.get(admissionId) });
  const [direction, setDirection] = React.useState<'intake' | 'output'>('intake');
  const [category, setCategory] = React.useState('oral');
  const [volume, setVolume] = React.useState('');
  const save = useSave(key, (body: I.IntakeOutputInput) => api.ipd.intakeOutput.record(admissionId, body), () => setVolume(''));

  return (
    <div className="space-y-6">
      {active && (
        <Can permission="ipd.nursing.write">
          <Card>
            <CardContent className="grid gap-3 pt-6 sm:grid-cols-4">
              <Field id="io-dir" label="Type">
                <Select
                  id="io-dir"
                  value={direction}
                  onChange={(e) => {
                    const d = e.target.value as 'intake' | 'output';
                    setDirection(d);
                    setCategory(I.IO_CATEGORIES[d][0]);
                  }}
                >
                  <option value="intake">Intake</option>
                  <option value="output">Output</option>
                </Select>
              </Field>
              <Field id="io-cat" label="Route / kind">
                <Select id="io-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {I.IO_CATEGORIES[direction].map((c) => (
                    <option key={c} value={c}>
                      {IO_LABELS[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="io-vol" label="Volume (ml)">
                <Input id="io-vol" type="number" min={0} value={volume} onChange={(e) => setVolume(e.target.value)} />
              </Field>
              <div className="flex items-end">
                <Button
                  className="w-full"
                  disabled={save.isPending || volume === ''}
                  onClick={() => save.mutate({ direction, category: category as I.IntakeOutputInput['category'], volumeMl: Number(volume) })}
                >
                  Add
                </Button>
              </div>
              <div className="sm:col-span-4">
                <ErrorBox error={save.error ? errorMessage(save.error) : null} />
              </div>
            </CardContent>
          </Card>
        </Can>
      )}
      <ErrorBox error={error ? errorMessage(error) : null} />
      {data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Daily balance</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Intake</TableHead>
                  <TableHead className="text-right">Output</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.days.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                      Nothing charted yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.days.map((d) => (
                    <TableRow key={d.date}>
                      <TableCell>{d.date}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.intakeMl} ml</TableCell>
                      <TableCell className="text-right tabular-nums">{d.outputMl} ml</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {d.balanceMl > 0 ? '+' : ''}
                        {d.balanceMl} ml
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Entries</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {data.entries.map((e) => (
                  <li key={e.id} className="flex justify-between py-2">
                    <span>
                      {formatDateTime(e.recordedAt)} · {e.direction === 'intake' ? 'In' : 'Out'}: {IO_LABELS[e.category] ?? e.category}
                    </span>
                    <span className="tabular-nums">{e.volumeMl} ml</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ---------- medications (MAR) ----------

export function MedicationsTab({ admissionId, active }: Props) {
  const key = ['ipd', 'meds', admissionId];
  const canGive = usePermission('ipd.nursing.write');
  const canOrder = usePermission('ipd.medication.order');
  const { data, error } = useQuery({ queryKey: key, queryFn: () => api.ipd.medications.list(admissionId) });
  const empty = { drugName: '', dose: '', route: 'oral' as I.MedRoute, frequency: '', instructions: '', isPrn: false };
  const [form, setForm] = React.useState(empty);
  const order = useSave(key, (body: I.MedicationOrderInput) => api.ipd.medications.order(admissionId, body), () => setForm(empty));
  const give = useSave(key, (v: { orderId: string; status: I.AdministrationStatus }) => api.ipd.medications.administer(admissionId, v.orderId, { status: v.status }));
  const stop = useSave(key, (v: { orderId: string; reason: string }) => api.ipd.medications.stop(admissionId, v.orderId, { reason: v.reason }));
  const err = order.error ?? give.error ?? stop.error;

  return (
    <div className="space-y-6">
      {active && canOrder && (
        <Card>
          <CardHeader>
            <CardTitle>Order medication</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 sm:grid-cols-6"
              onSubmit={(e) => {
                e.preventDefault();
                order.mutate({ ...form, instructions: form.instructions || undefined });
              }}
            >
              <Field id="m-drug" label="Drug" className="sm:col-span-2">
                <Input id="m-drug" value={form.drugName} onChange={(e) => setForm({ ...form, drugName: e.target.value })} required maxLength={200} />
              </Field>
              <Field id="m-dose" label="Dose">
                <Input id="m-dose" value={form.dose} onChange={(e) => setForm({ ...form, dose: e.target.value })} required placeholder="500 mg" maxLength={100} />
              </Field>
              <Field id="m-route" label="Route">
                <Select id="m-route" value={form.route} onChange={(e) => setForm({ ...form, route: e.target.value as I.MedRoute })}>
                  {I.MED_ROUTES.map((r) => (
                    <option key={r} value={r}>
                      {ROUTE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="m-freq" label="Frequency">
                <Input id="m-freq" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })} required placeholder="BD, TDS, Q8H…" maxLength={50} />
              </Field>
              <div className="flex items-end">
                <Button type="submit" className="w-full" disabled={order.isPending}>
                  Order
                </Button>
              </div>
              <Field id="m-ins" label="Instructions" className="sm:col-span-5">
                <Input id="m-ins" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} maxLength={500} />
              </Field>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input type="checkbox" checked={form.isPrn} onChange={(e) => setForm({ ...form, isPrn: e.target.checked })} /> SOS / PRN
              </label>
            </form>
          </CardContent>
        </Card>
      )}
      <ErrorBox error={err ? errorMessage(err) : error ? errorMessage(error) : null} />
      {!data?.length ? (
        <p className="text-sm text-muted-foreground">No medications ordered.</p>
      ) : (
        <div className="space-y-3">
          {data.map((m) => (
            <Card key={m.id} className={m.status === 'stopped' ? 'opacity-60' : ''}>
              <CardContent className="flex flex-col gap-3 pt-6 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="font-medium">
                    {m.drugName} <span className="font-normal">{m.dose}</span> · {ROUTE_LABELS[m.route]} · {m.frequency}
                    {m.isPrn && (
                      <Badge variant="secondary" className="ml-2">
                        SOS
                      </Badge>
                    )}
                    {m.status === 'stopped' && (
                      <Badge variant="outline" className="ml-2">
                        Stopped
                      </Badge>
                    )}
                  </p>
                  {m.instructions && <p className="text-sm text-muted-foreground">{m.instructions}</p>}
                  <p className="text-xs text-muted-foreground">
                    Ordered {formatDateTime(m.startAt)} by {m.orderedByName ?? 'doctor'}
                    {m.stoppedAt && ` · stopped ${formatDateTime(m.stoppedAt)} (${m.stopReason})`}
                  </p>
                  {m.administrations.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
                      {m.administrations.slice(0, 8).map((a) => (
                        <li key={a.id} className="rounded border px-1.5 py-0.5" title={a.givenByName ?? ''}>
                          {formatDateTime(a.givenAt)} · {a.status}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {active && m.status === 'active' && (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {canGive && (
                      <>
                        <Button size="sm" disabled={give.isPending} onClick={() => give.mutate({ orderId: m.id, status: 'given' })}>
                          Mark given
                        </Button>
                        <Select
                          aria-label="Not given"
                          className="h-8 w-32 text-xs"
                          value=""
                          onChange={(e) => e.target.value && give.mutate({ orderId: m.id, status: e.target.value as I.AdministrationStatus })}
                        >
                          <option value="">Not given…</option>
                          <option value="held">Held</option>
                          <option value="refused">Refused</option>
                          <option value="missed">Missed</option>
                        </Select>
                      </>
                    )}
                    {canOrder && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={stop.isPending}
                        onClick={() => {
                          const reason = window.prompt('Why stop this medication?');
                          if (reason && reason.trim().length >= 2) stop.mutate({ orderId: m.id, reason });
                        }}
                      >
                        Stop
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- doctor rounds ----------

export function RoundsTab({ admissionId, active }: Props) {
  const key = ['ipd', 'rounds', admissionId];
  const { data, error } = useQuery({ queryKey: key, queryFn: () => api.ipd.rounds.list(admissionId) });
  const empty = { subjective: '', findings: '', plan: '' };
  const [form, setForm] = React.useState(empty);
  const save = useSave(key, (body: I.RoundInput) => api.ipd.rounds.add(admissionId, body), () => setForm(empty));

  return (
    <div className="space-y-6">
      {active && (
        <Can permission="ipd.round.write">
          <Card>
            <CardHeader>
              <CardTitle>Round note</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Field id="r-s" label="Patient says (subjective)">
                <Textarea id="r-s" rows={2} value={form.subjective} onChange={(e) => setForm({ ...form, subjective: e.target.value })} maxLength={2000} />
              </Field>
              <Field id="r-f" label="Findings">
                <Textarea id="r-f" rows={2} value={form.findings} onChange={(e) => setForm({ ...form, findings: e.target.value })} maxLength={4000} />
              </Field>
              <Field id="r-p" label="Plan">
                <Textarea id="r-p" rows={2} value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} maxLength={4000} />
              </Field>
              <div>
                <Button
                  disabled={save.isPending || form.plan.trim().length < 2}
                  onClick={() => save.mutate({ plan: form.plan, subjective: form.subjective || undefined, findings: form.findings || undefined })}
                >
                  Save round
                </Button>
              </div>
              <ErrorBox error={save.error ? errorMessage(save.error) : null} />
            </CardContent>
          </Card>
        </Can>
      )}
      <ErrorBox error={error ? errorMessage(error) : null} />
      {!data?.length ? (
        <p className="text-sm text-muted-foreground">No rounds recorded yet.</p>
      ) : (
        <ul className="space-y-3">
          {data.map((r) => (
            <li key={r.id} className="rounded-lg border bg-card p-4 text-sm">
              <p className="mb-2 text-xs text-muted-foreground">
                {formatDateTime(r.roundAt)} · Dr. {r.doctorName.replace(/^Dr\.?\s*/i, '')}
              </p>
              {r.subjective && (
                <p>
                  <span className="font-medium">S: </span>
                  {r.subjective}
                </p>
              )}
              {r.findings && (
                <p>
                  <span className="font-medium">O: </span>
                  {r.findings}
                </p>
              )}
              <p className="whitespace-pre-wrap">
                <span className="font-medium">Plan: </span>
                {r.plan}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
