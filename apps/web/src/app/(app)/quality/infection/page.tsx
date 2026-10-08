'use client';

import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { quality as Q } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/validate';
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
        {adding && <NewCase onDone={() => setAdding(false)} />}
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : !data?.items.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
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

function NewCase({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [patient, setPatient] = React.useState<Q.PatientRef | null>(null);
  const [f, setF] = React.useState({ infectionType: '' as Q.HaiType | '', ward: '', onsetDate: todayIST(), deviceInsertedOn: '', procedureName: '', organism: '', cultureRef: '', notes: '' });
  const [status, setStatus] = React.useState<Q.HaiStatus | ''>('suspected');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const create = useMutation({
    mutationFn: (body: Q.CreateHai) => api.quality.hai.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality'] });
      onDone();
    },
  });
  const body = (): Q.CreateHai => ({
        patientId: patient?.id ?? '',
        infectionType: f.infectionType as Q.HaiType,
        ward: f.ward || undefined,
        onsetDate: f.onsetDate,
        deviceInsertedOn: f.deviceInsertedOn || undefined,
        procedureName: f.procedureName || undefined,
        organism: f.organism || undefined,
        cultureRef: f.cultureRef || undefined,
        notes: f.notes || undefined,
        status: status || 'suspected',
      });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Record an infection</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            const b = body();
            const { errors: found } = validate(Q.createHaiSchema, b);
            setErrors(found ?? {});
            if (!found) create.mutate(b);
          }}
        >
          <div className="sm:col-span-3">
            <ErrorBox error={Object.keys(errors).length ? 'Please correct the highlighted fields' : create.error} />
          </div>
          <Field id="hai-patient" label="Patient *" className="sm:col-span-2">
            <PatientPicker value={patient} onChange={setPatient} />
          </Field>
          <Field id="hai-type" label="Infection *">
            <EnumSelect id="hai-type" value={f.infectionType} onChange={(v) => setF({ ...f, infectionType: v })} options={Q.HAI_TYPES} labels={HAI_LABELS} placeholder="Choose…" />
          </Field>
          <Field id="hai-onset" label="Onset date *" error={errors.onsetDate}>
            <Input id="hai-onset" type="date" required max={todayIST()} value={f.onsetDate} onChange={set('onsetDate')} />
          </Field>
          <Field id="hai-device" label={f.infectionType === 'ssi' ? 'Surgery date' : 'Device inserted on'} error={errors.deviceInsertedOn}>
            <Input id="hai-device" type="date" max={f.onsetDate || todayIST()} value={f.deviceInsertedOn} onChange={set('deviceInsertedOn')} />
          </Field>
          <Field id="hai-ward" label="Ward">
            <Input id="hai-ward" maxLength={80} value={f.ward} onChange={set('ward')} />
          </Field>
          {f.infectionType === 'ssi' && (
            <Field id="hai-proc" label="Procedure">
              <Input id="hai-proc" value={f.procedureName} onChange={set('procedureName')} />
            </Field>
          )}
          <Field id="hai-org" label="Organism">
            <Input id="hai-org" value={f.organism} onChange={set('organism')} />
          </Field>
          <Field id="hai-culture" label="Culture report no.">
            <Input id="hai-culture" value={f.cultureRef} onChange={set('cultureRef')} />
          </Field>
          <Field id="hai-status" label="Status">
            <EnumSelect id="hai-status" value={status} onChange={setStatus} options={Q.HAI_STATUSES} />
          </Field>
          <Field id="hai-notes" label="Notes" className="sm:col-span-3">
            <Textarea id="hai-notes" value={f.notes} onChange={set('notes')} />
          </Field>
          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" disabled={create.isPending || !patient || !f.infectionType}>
              {create.isPending && <Loader2 className="animate-spin" />} Save case
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
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const censusBody = (): Q.CensusInput => ({
    day: f.day,
    ward: f.ward || 'All',
    patientDays: f.patientDays || 0,
    catheterDays: f.catheterDays || 0,
    centralLineDays: f.centralLineDays || 0,
    ventilatorDays: f.ventilatorDays || 0,
    surgeries: f.surgeries || 0,
  });
  const save = useMutation({
    mutationFn: (body: Q.CensusInput) => api.quality.census.save(body),
    onSuccess: () => {
      setF({ ...blank, day: f.day });
      queryClient.invalidateQueries({ queryKey: ['quality'] });
    },
  });
  const num = (k: keyof typeof f, label: string) => (
    <Field id={`c-${k}`} label={label} error={errors[k]}>
      <Input id={`c-${k}`} type="number" min={0} max={100000} step={1} value={f[k]} onChange={set(k)} />
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
            const b = censusBody();
            const { errors: found } = validate(Q.censusInputSchema, b);
            setErrors(found ?? {});
            if (!found) save.mutate(b);
          }}
        >
          <Field id="c-day" label="Day" error={errors.day}>
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
