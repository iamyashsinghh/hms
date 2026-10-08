'use client';

import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flame, Loader2, Pencil, Plus, Search } from 'lucide-react';
import { ops as O, type Patient } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  CSSD_METHOD_LABELS,
  CSSD_STATUS,
  ErrorBox,
  Field,
  MessageRow,
  PatientPicker,
  StatusBadge,
  Textarea,
  firstIssue,
  formatDateTime,
  num,
  opt,
  useDebounced,
} from '@/modules/ops/ui';

/** New instrument set; with `initial` it edits that set (name, department, contents, shelf life, active). */
function SetForm({ initial, onDone }: { initial?: O.CssdSet; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [f, setF] = React.useState({
    name: initial?.name ?? '',
    department: initial?.department ?? '',
    contents: initial?.contents.join('\n') ?? '',
    shelfLifeDays: String(initial?.shelfLifeDays ?? 30),
    isActive: initial?.isActive ?? true,
  });
  const [invalid, setInvalid] = React.useState<string | null>(null);
  const body = (): O.UpdateCssdSet & { name: string } => ({
    name: f.name.trim(),
    // An emptied department is cleared on edit; omitted on create.
    department: initial ? f.department.trim() || null : opt(f.department),
    contents: f.contents
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
    shelfLifeDays: num(f.shelfLifeDays),
    ...(initial ? { isActive: f.isActive } : {}),
  });
  const save = useMutation({
    mutationFn: (b: O.UpdateCssdSet & { name: string }) =>
      initial ? api.ops.cssd.updateSet(initial.id, b) : api.ops.cssd.createSet({ ...b, department: b.department ?? undefined }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] });
      onDone();
    },
  });
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{initial ? `Edit ${initial.code}` : 'New instrument set'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            const b = body();
            const problem = firstIssue(initial ? O.updateCssdSetSchema : O.cssdSetInputSchema, b, { name: 'Set name', shelfLifeDays: 'Shelf life', contents: 'Contents', department: 'Department' });
            setInvalid(problem);
            if (!problem) save.mutate(b);
          }}
        >
          <div className="sm:col-span-3">
            <ErrorBox error={invalid ?? (save.error ? errorMessage(save.error) : null)} />
          </div>
          <Field id="set-name" label="Set name *">
            <Input id="set-name" maxLength={200} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Major laparotomy set" required />
          </Field>
          <Field id="set-dept" label="Department">
            <Input id="set-dept" maxLength={100} value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} placeholder="e.g. OT 1" />
          </Field>
          <Field id="set-shelf" label="Shelf life (days)">
            <Input id="set-shelf" type="number" min={1} max={365} step={1} value={f.shelfLifeDays} onChange={(e) => setF({ ...f, shelfLifeDays: e.target.value })} />
          </Field>
          <Field id="set-contents" label="Contents (one instrument per line)" className="sm:col-span-3">
            <Textarea id="set-contents" rows={5} value={f.contents} onChange={(e) => setF({ ...f, contents: e.target.value })} placeholder={'Artery forceps x4\nMayo scissors x2'} />
          </Field>
          {initial && (
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active (inactive sets are not offered for cycles or issue)
            </label>
          )}
          <div className="flex justify-end gap-2 sm:col-span-3">
            <Button type="button" variant="outline" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function StartCycleForm({ dirty, onDone }: { dirty: O.CssdSet[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [setIds, setSetIds] = React.useState<string[]>([]);
  const [sterilizer, setSterilizer] = React.useState('');
  const [method, setMethod] = React.useState<O.CssdMethod>('steam');
  const [temp, setTemp] = React.useState('134');
  const [pressure, setPressure] = React.useState('');
  const start = useMutation({
    mutationFn: () => api.ops.cssd.startCycle({ sterilizer: sterilizer.trim(), method, setIds, temperatureC: num(temp), pressure: opt(pressure) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] });
      onDone();
    },
  });
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Start sterilization cycle</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            start.mutate();
          }}
        >
          <div className="sm:col-span-4">
            <ErrorBox error={start.error ? errorMessage(start.error) : null} />
          </div>
          <Field id="cy-ster" label="Sterilizer *">
            <Input id="cy-ster" value={sterilizer} onChange={(e) => setSterilizer(e.target.value)} placeholder="e.g. Autoclave 1" required />
          </Field>
          <Field id="cy-method" label="Method">
            <Select id="cy-method" value={method} onChange={(e) => setMethod(e.target.value as O.CssdMethod)}>
              {O.CSSD_METHODS.map((m) => (
                <option key={m} value={m}>
                  {CSSD_METHOD_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="cy-temp" label="Temperature (°C)">
            <Input id="cy-temp" type="number" min={0} max={300} value={temp} onChange={(e) => setTemp(e.target.value)} />
          </Field>
          <Field id="cy-pressure" label="Pressure">
            <Input id="cy-pressure" value={pressure} onChange={(e) => setPressure(e.target.value)} placeholder="e.g. 2.1 bar" />
          </Field>
          <Field label={`Dirty sets in this load (${setIds.length} selected) *`} className="sm:col-span-4">
            {dirty.length === 0 ? (
              <p className="text-sm text-muted-foreground">No dirty sets waiting.</p>
            ) : (
              <div className="grid max-h-56 gap-1 overflow-auto rounded-md border p-2 sm:grid-cols-3">
                {dirty.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={setIds.includes(s.id)}
                      onChange={(e) => setSetIds(e.target.checked ? [...setIds, s.id] : setIds.filter((x) => x !== s.id))}
                    />
                    {s.name} <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
                  </label>
                ))}
              </div>
            )}
          </Field>
          <div className="flex justify-end gap-2 sm:col-span-4">
            <Button type="button" variant="outline" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={start.isPending || setIds.length === 0}>
              {start.isPending && <Loader2 className="animate-spin" />}
              Start cycle
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function CompleteCycleRow({ cycle, onDone }: { cycle: O.CssdCycle; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [chem, setChem] = React.useState(true);
  const [bio, setBio] = React.useState<'' | 'pass' | 'fail'>('');
  const [notes, setNotes] = React.useState('');
  const complete = useMutation({
    mutationFn: () =>
      api.ops.cssd.completeCycle(cycle.id, {
        chemicalIndicatorPassed: chem,
        biologicalIndicatorPassed: bio === '' ? undefined : bio === 'pass',
        notes: opt(notes),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] });
      onDone();
    },
  });
  return (
    <form
      className="grid gap-3 sm:grid-cols-5"
      onSubmit={(e) => {
        e.preventDefault();
        complete.mutate();
      }}
    >
      <div className="sm:col-span-5">
        <ErrorBox error={complete.error ? errorMessage(complete.error) : null} />
      </div>
      <label className="flex items-center gap-2 pt-6 text-sm">
        <input type="checkbox" checked={chem} onChange={(e) => setChem(e.target.checked)} /> Chemical indicator passed
      </label>
      <Field id={`bio-${cycle.id}`} label="Biological indicator">
        <Select id={`bio-${cycle.id}`} value={bio} onChange={(e) => setBio(e.target.value as typeof bio)}>
          <option value="">Not run</option>
          <option value="pass">Passed</option>
          <option value="fail">Failed</option>
        </Select>
      </Field>
      <Field id={`notes-${cycle.id}`} label="Notes" className="sm:col-span-2">
        <Input id={`notes-${cycle.id}`} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex items-end justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Back
        </Button>
        <Button type="submit" size="sm" variant={!chem || bio === 'fail' ? 'destructive' : 'default'} disabled={complete.isPending}>
          {complete.isPending && <Loader2 className="animate-spin" />}
          {!chem || bio === 'fail' ? 'Record failure' : 'Release load'}
        </Button>
      </div>
    </form>
  );
}

function IssueRow({ set, onDone }: { set: O.CssdSet; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [issuedTo, setIssuedTo] = React.useState('');
  const [patient, setPatient] = React.useState<Patient | null>(null);
  const issue = useMutation({
    mutationFn: () => api.ops.cssd.issue({ setId: set.id, issuedTo: issuedTo.trim(), patientId: patient?.id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] });
      onDone();
    },
  });
  return (
    <form
      className="grid gap-3 sm:grid-cols-5"
      onSubmit={(e) => {
        e.preventDefault();
        issue.mutate();
      }}
    >
      <div className="sm:col-span-5">
        <ErrorBox error={issue.error ? errorMessage(issue.error) : null} />
      </div>
      <Field id={`to-${set.id}`} label="Issue to (OT / ward) *" className="sm:col-span-2">
        <Input id={`to-${set.id}`} value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} placeholder="e.g. OT 2" required autoFocus />
      </Field>
      <div className="sm:col-span-2">
        <PatientPicker value={patient} onChange={setPatient} label="Patient (optional, for recall tracing)" />
      </div>
      <div className="flex items-end justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Back
        </Button>
        <Button type="submit" size="sm" disabled={issue.isPending}>
          {issue.isPending && <Loader2 className="animate-spin" />}
          Issue
        </Button>
      </div>
    </form>
  );
}

export default function CssdPage() {
  const canRead = usePermission('ops.cssd.read');
  const canManage = usePermission('ops.cssd.manage');
  const queryClient = useQueryClient();
  const [panel, setPanel] = React.useState<'set' | 'cycle' | null>(null);
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [completing, setCompleting] = React.useState<string | null>(null);
  const [issuing, setIssuing] = React.useState<string | null>(null);
  const [editingSet, setEditingSet] = React.useState<O.CssdSet | null>(null);
  const q = useDebounced(search.trim());

  const setQuery = { q: q || undefined, status: (status || undefined) as O.CssdSetStatus | undefined };
  const sets = useQuery({ queryKey: ['ops', 'cssd', 'sets', setQuery], queryFn: () => api.ops.cssd.sets(setQuery), placeholderData: keepPreviousData, enabled: canRead });
  const dirty = useQuery({ queryKey: ['ops', 'cssd', 'sets', { status: 'dirty' }], queryFn: () => api.ops.cssd.sets({ status: 'dirty' }), enabled: canManage && panel === 'cycle' });
  const cycles = useQuery({ queryKey: ['ops', 'cssd', 'cycles'], queryFn: () => api.ops.cssd.cycles({ pageSize: 20 }), enabled: canRead });
  const openIssues = useQuery({ queryKey: ['ops', 'cssd', 'issues', 'open'], queryFn: () => api.ops.cssd.issues({ open: 'true' }), enabled: canRead });

  const returnSet = useMutation({
    mutationFn: (issueId: string) => api.ops.cssd.returnSet(issueId, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['ops'] }),
  });

  if (!canRead) return <NoAccess />;

  const issueBySet = new Map((openIssues.data ?? []).map((i) => [i.setId, i]));
  const running = cycles.data?.items.filter((c) => c.status === 'running') ?? [];
  const recent = cycles.data?.items.filter((c) => c.status !== 'running').slice(0, 8) ?? [];

  return (
    <>
      <PageHeader
        title="CSSD"
        description="Instrument sets, sterilization cycles with indicator results, and issue / return tracing."
        actions={
          <Can permission="ops.cssd.manage">
            <Button variant="outline" onClick={() => setPanel('set')}>
              <Plus /> Add set
            </Button>
            <Button onClick={() => setPanel('cycle')}>
              <Flame /> Start cycle
            </Button>
          </Can>
        }
      />

      {canManage && panel === 'set' && <SetForm onDone={() => setPanel(null)} />}
      {canManage && editingSet && <SetForm key={editingSet.id} initial={editingSet} onDone={() => setEditingSet(null)} />}
      {canManage && panel === 'cycle' && (dirty.data ? <StartCycleForm dirty={dirty.data} onDone={() => setPanel(null)} /> : <p className="mb-6 text-sm text-muted-foreground">Loading dirty sets…</p>)}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Sterilization cycles</CardTitle>
        </CardHeader>
        {cycles.error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(cycles.error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Cycle</TableHead>
                <TableHead>Sterilizer / method</TableHead>
                <TableHead>Sets</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Result</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {cycles.isPending ? (
                <MessageRow cols={6}>Loading…</MessageRow>
              ) : running.length + recent.length === 0 ? (
                <MessageRow cols={6}>No cycles yet.</MessageRow>
              ) : (
                [...running, ...recent].map((c) => (
                  <React.Fragment key={c.id}>
                    <TableRow>
                      <TableCell className="font-mono text-xs">{c.number}</TableCell>
                      <TableCell>
                        {c.sterilizer}
                        <div className="text-xs text-muted-foreground">
                          {CSSD_METHOD_LABELS[c.method]}
                          {c.temperatureC != null && ` · ${c.temperatureC}°C`}
                          {c.pressure && ` · ${c.pressure}`}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs whitespace-normal text-xs">{c.sets.map((s) => s.name).join(', ')}</TableCell>
                      <TableCell className="text-xs">{formatDateTime(c.startedAt)}</TableCell>
                      <TableCell>
                        {c.status === 'running' ? (
                          <Badge variant="default">Running</Badge>
                        ) : c.status === 'passed' ? (
                          <Badge variant="accent">Passed</Badge>
                        ) : (
                          <Badge variant="destructive">Failed</Badge>
                        )}
                        {c.biologicalIndicatorPassed != null && <div className="text-xs text-muted-foreground">BI {c.biologicalIndicatorPassed ? 'passed' : 'failed'}</div>}
                        {c.notes && <div className="text-xs text-muted-foreground">{c.notes}</div>}
                      </TableCell>
                      <TableCell className="text-right">
                        {canManage && c.status === 'running' && (
                          <Button size="sm" onClick={() => setCompleting(c.id)}>
                            Complete
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                    {completing === c.id && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={6}>
                          <CompleteCycleRow cycle={c} onDone={() => setCompleting(null)} />
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" placeholder="Search set code or name…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select className="w-44" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {O.CSSD_SET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CSSD_STATUS[s].label}
              </option>
            ))}
          </Select>
          {sets.isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
        {returnSet.error && (
          <div className="p-4 pb-0">
            <ErrorBox error={errorMessage(returnSet.error)} />
          </div>
        )}
        {sets.error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(sets.error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Code</TableHead>
                <TableHead>Set</TableHead>
                <TableHead>Contents</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sterile until</TableHead>
                <TableHead>Issued to</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sets.isPending ? (
                <MessageRow cols={7}>Loading…</MessageRow>
              ) : sets.data.length === 0 ? (
                <MessageRow cols={7}>No instrument sets.</MessageRow>
              ) : (
                sets.data.map((s) => {
                  const issue = issueBySet.get(s.id);
                  return (
                    <React.Fragment key={s.id}>
                      <TableRow>
                        <TableCell className="font-mono text-xs">{s.code}</TableCell>
                        <TableCell className="font-medium">
                          {s.name} {!s.isActive && <Badge variant="secondary">Inactive</Badge>}
                          {s.department && <div className="text-xs font-normal text-muted-foreground">{s.department}</div>}
                        </TableCell>
                        <TableCell className="max-w-xs whitespace-normal text-xs text-muted-foreground" title={s.contents.join('\n')}>
                          {s.contents.length ? `${s.contents.length} items: ${s.contents.slice(0, 3).join(', ')}${s.contents.length > 3 ? '…' : ''}` : '—'}
                        </TableCell>
                        <TableCell>
                          <StatusBadge s={CSSD_STATUS[s.status]} /> {s.expired && <Badge variant="destructive">Expired</Badge>}
                        </TableCell>
                        <TableCell className={s.expired ? 'text-xs font-medium text-destructive' : 'text-xs'}>{formatDateTime(s.sterileUntil)}</TableCell>
                        <TableCell className="text-xs">
                          {s.issuedTo ?? '—'}
                          {issue && <div className="text-muted-foreground">{formatDateTime(issue.issuedAt)}</div>}
                        </TableCell>
                        <TableCell className="space-x-1 text-right">
                          {canManage && (
                            <Button size="sm" variant="ghost" aria-label={`Edit ${s.code}`} onClick={() => setEditingSet(s)}>
                              <Pencil />
                            </Button>
                          )}
                          {canManage && s.status === 'sterile' && !s.expired && (
                            <Button size="sm" variant="outline" onClick={() => setIssuing(issuing === s.id ? null : s.id)}>
                              Issue
                            </Button>
                          )}
                          {canManage && s.status === 'issued' && issue && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={returnSet.isPending}
                              onClick={() => {
                                if (window.confirm(`Receive ${s.name} back from ${issue.issuedTo}? It goes to dirty for reprocessing.`)) returnSet.mutate(issue.id);
                              }}
                            >
                              Return
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                      {issuing === s.id && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={7}>
                            <IssueRow set={s} onDone={() => setIssuing(null)} />
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
