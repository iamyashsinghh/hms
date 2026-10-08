'use client';

import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus } from 'lucide-react';
import { quality as Q } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EnumSelect, ErrorBox, Field, HAI_LABELS, Pager, PatientPicker, StatusBadge, Textarea, todayIST } from '@/modules/quality/ui';

export default function InfectionControlPage() {
  const can = usePermission('quality.hai.read');
  const canManage = usePermission('quality.hai.manage');
  const queryClient = useQueryClient();
  const [type, setType] = React.useState<Q.HaiType | ''>('');
  const [status, setStatus] = React.useState<Q.HaiStatus | ''>('');
  const [page, setPage] = React.useState(1);
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState<Q.HaiCase | null>(null);
  const query = { infectionType: type || undefined, status: status || undefined, page, pageSize: 25 };
  const { data, isPending, error } = useQuery({
    queryKey: ['quality', 'hai', query],
    queryFn: () => api.quality.hai.list(query),
    placeholderData: keepPreviousData,
    enabled: can,
  });
  const setCaseStatus = useMutation({
    mutationFn: ({ id, s }: { id: string; s: Q.HaiStatus }) => api.quality.hai.update(id, { status: s }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['quality'] }),
  });

  if (!can) return <NoAccess />;
  return (
    <>
      <PageHeader
        title="Infection control"
        description="Hospital-acquired infections (HAI) and the daily device days used to calculate CAUTI, CLABSI, VAP and SSI rates."
        actions={
          canManage && (
            <Button onClick={() => setAdding(true)}>
              <Plus /> Record infection
            </Button>
          )
        }
      />
      <div className="space-y-6">
        {adding && <CaseForm onDone={() => setAdding(false)} />}
        {editing && canManage && <CaseForm key={editing.id} initial={editing} onDone={() => setEditing(null)} />}
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b p-4">
            <div className="w-56">
              <EnumSelect value={type} onChange={(v) => (setType(v), setPage(1))} options={Q.HAI_TYPES} labels={HAI_LABELS} placeholder="Any infection" />
            </div>
            <div className="w-40">
              <EnumSelect value={status} onChange={(v) => (setStatus(v), setPage(1))} options={Q.HAI_STATUSES} placeholder="Any status" />
            </div>
          </div>
          {(error || setCaseStatus.error) && <p className="px-4 pt-3 text-sm text-destructive">{errorMessage(error ?? setCaseStatus.error)}</p>}
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Case</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Infection</TableHead>
                <TableHead>Ward</TableHead>
                <TableHead>Onset</TableHead>
                <TableHead>Organism</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 8 : 7} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : !data?.items.length ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 8 : 7} className="py-10 text-center text-muted-foreground">
                    No infection cases recorded.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="font-mono text-xs">{h.caseNo}</TableCell>
                    <TableCell>
                      {h.patient.name} <span className="font-mono text-xs text-muted-foreground">{h.patient.uhid}</span>
                    </TableCell>
                    <TableCell>{h.infectionType.toUpperCase()}</TableCell>
                    <TableCell>{h.ward ?? '—'}</TableCell>
                    <TableCell>{h.onsetDate}</TableCell>
                    <TableCell>{h.organism ?? '—'}</TableCell>
                    <TableCell>
                      {canManage ? (
                        <select
                          aria-label={`Status of ${h.caseNo}`}
                          className="h-8 rounded-md border bg-background px-2 text-xs"
                          value={h.status}
                          onChange={(e) => setCaseStatus.mutate({ id: h.id, s: e.target.value as Q.HaiStatus })}
                        >
                          {Q.HAI_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s.replace('_', ' ')}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <StatusBadge status={h.status} />
                      )}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" aria-label={`Edit ${h.caseNo}`} onClick={() => setEditing(h)}>
                          <Pencil />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <Pager data={data} page={page} setPage={setPage} />
        </Card>
        <Can permission="quality.census.manage">
          <Census />
        </Can>
      </div>
    </>
  );
}

/** Record a new infection case; with `initial` it edits that case (patient and case number stay). */
function CaseForm({ initial, onDone }: { initial?: Q.HaiCase; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [patient, setPatient] = React.useState<Q.PatientRef | null>(initial?.patient ?? null);
  const [f, setF] = React.useState({
    infectionType: (initial?.infectionType ?? '') as Q.HaiType | '',
    ward: initial?.ward ?? '',
    onsetDate: initial?.onsetDate ?? todayIST(),
    deviceInsertedOn: initial?.deviceInsertedOn ?? '',
    procedureName: initial?.procedureName ?? '',
    organism: initial?.organism ?? '',
    cultureRef: initial?.cultureRef ?? '',
    notes: initial?.notes ?? '',
  });
  const [status, setStatus] = React.useState<Q.HaiStatus | ''>(initial?.status ?? 'suspected');
  const [invalid, setInvalid] = React.useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => {
      const common = {
        infectionType: f.infectionType as Q.HaiType,
        ward: f.ward,
        onsetDate: f.onsetDate,
        procedureName: f.procedureName,
        organism: f.organism,
        cultureRef: f.cultureRef,
        notes: f.notes,
        status: status || 'suspected',
      };
      return initial
        ? api.quality.hai.update(initial.id, { ...common, deviceInsertedOn: f.deviceInsertedOn || null })
        : api.quality.hai.create({ ...common, patientId: patient!.id, deviceInsertedOn: f.deviceInsertedOn || undefined });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality'] });
      onDone();
    },
  });
  const validate = (): string | null => {
    if (!patient) return 'Pick the patient';
    if (!f.infectionType) return 'Pick the infection type';
    if (!f.onsetDate) return 'Onset date is required';
    if (f.onsetDate > todayIST()) return 'Onset date cannot be in the future';
    if (f.deviceInsertedOn && f.deviceInsertedOn > f.onsetDate) return 'Device insertion / surgery date must be on or before the onset date';
    return null;
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{initial ? `Edit ${initial.caseNo}` : 'Record an infection'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            const problem = validate();
            setInvalid(problem);
            if (!problem) save.mutate();
          }}
        >
          <div className="sm:col-span-3">
            <ErrorBox error={invalid ?? save.error} />
          </div>
          <Field id="hai-patient" label="Patient *" className="sm:col-span-2">
            {initial ? (
              <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">
                {initial.patient.name} <span className="ml-2 font-mono text-xs text-muted-foreground">{initial.patient.uhid}</span>
              </div>
            ) : (
              <PatientPicker value={patient} onChange={setPatient} />
            )}
          </Field>
          <Field id="hai-type" label="Infection *">
            <EnumSelect id="hai-type" value={f.infectionType} onChange={(v) => setF({ ...f, infectionType: v })} options={Q.HAI_TYPES} labels={HAI_LABELS} placeholder="Choose…" />
          </Field>
          <Field id="hai-onset" label="Onset date *">
            <Input id="hai-onset" type="date" required max={todayIST()} value={f.onsetDate} onChange={set('onsetDate')} />
          </Field>
          <Field id="hai-device" label={f.infectionType === 'ssi' ? 'Surgery date' : 'Device inserted on'}>
            <Input id="hai-device" type="date" max={f.onsetDate} value={f.deviceInsertedOn} onChange={set('deviceInsertedOn')} />
          </Field>
          <Field id="hai-ward" label="Ward">
            <Input id="hai-ward" maxLength={80} value={f.ward} onChange={set('ward')} />
          </Field>
          {f.infectionType === 'ssi' && (
            <Field id="hai-proc" label="Procedure">
              <Input id="hai-proc" maxLength={200} value={f.procedureName} onChange={set('procedureName')} />
            </Field>
          )}
          <Field id="hai-org" label="Organism">
            <Input id="hai-org" maxLength={200} value={f.organism} onChange={set('organism')} />
          </Field>
          <Field id="hai-culture" label="Culture report no.">
            <Input id="hai-culture" maxLength={80} value={f.cultureRef} onChange={set('cultureRef')} />
          </Field>
          <Field id="hai-status" label="Status">
            <EnumSelect id="hai-status" value={status} onChange={setStatus} options={Q.HAI_STATUSES} />
          </Field>
          <Field id="hai-notes" label="Notes" className="sm:col-span-3">
            <Textarea id="hai-notes" maxLength={2000} value={f.notes} onChange={set('notes')} />
          </Field>
          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" disabled={save.isPending || !patient || !f.infectionType}>
              {save.isPending && <Loader2 className="animate-spin" />} {initial ? 'Save changes' : 'Save case'}
            </Button>
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Census() {
  const queryClient = useQueryClient();
  const { data, error } = useQuery({ queryKey: ['quality', 'census'], queryFn: () => api.quality.census.list() });
  const blank = { day: todayIST(), ward: 'All', patientDays: '', catheterDays: '', centralLineDays: '', ventilatorDays: '', surgeries: '' };
  const [f, setF] = React.useState(blank);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () =>
      api.quality.census.save({
        day: f.day,
        ward: f.ward || 'All',
        patientDays: Number(f.patientDays || 0),
        catheterDays: Number(f.catheterDays || 0),
        centralLineDays: Number(f.centralLineDays || 0),
        ventilatorDays: Number(f.ventilatorDays || 0),
        surgeries: Number(f.surgeries || 0),
      }),
    onSuccess: () => {
      setF({ ...blank, day: f.day });
      queryClient.invalidateQueries({ queryKey: ['quality'] });
    },
  });
  const num = (k: keyof typeof f, label: string) => (
    <Field id={`c-${k}`} label={label}>
      <Input id={`c-${k}`} type="number" min={0} value={f[k]} onChange={set(k)} />
    </Field>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily census and device days</CardTitle>
        <p className="text-sm text-muted-foreground">
          Wards in IPD fill this automatically every day. Enter by hand only for wards IPD does not cover, or to add surgeries. Saving the same ward and day again replaces it.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ErrorBox error={save.error ?? error} />
        <form
          className="grid gap-3 sm:grid-cols-4 lg:grid-cols-8"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field id="c-day" label="Day">
            <Input id="c-day" type="date" max={todayIST()} value={f.day} onChange={set('day')} />
          </Field>
          <Field id="c-ward" label="Ward">
            <Input id="c-ward" value={f.ward} onChange={set('ward')} />
          </Field>
          {num('patientDays', 'Patients')}
          {num('catheterDays', 'Urinary catheters')}
          {num('centralLineDays', 'Central lines')}
          {num('ventilatorDays', 'Ventilators')}
          {num('surgeries', 'Surgeries')}
          <div className="flex items-end">
            <Button type="submit" className="w-full" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />} Save
            </Button>
          </div>
        </form>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Day</TableHead>
              <TableHead>Ward</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Patients</TableHead>
              <TableHead className="text-right">Catheters</TableHead>
              <TableHead className="text-right">Central lines</TableHead>
              <TableHead className="text-right">Ventilators</TableHead>
              <TableHead className="text-right">Surgeries</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data?.length ? (
              <TableRow>
                <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                  No census entered in the last 30 days.
                </TableCell>
              </TableRow>
            ) : (
              data.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.day}</TableCell>
                  <TableCell>{c.ward}</TableCell>
                  <TableCell>{c.source === 'ipd' ? <Badge variant="accent">IPD</Badge> : <Badge variant="outline">Manual</Badge>}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.patientDays}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.catheterDays}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.centralLineDays}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.ventilatorDays}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.surgeries}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
