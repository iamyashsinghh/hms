'use client';

import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { ops as O } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorBox, Field, HK_KIND_LABELS, HK_STATUS, MessageRow, Pager, PriorityBadge, StatusBadge, formatDateTime, opt, checked } from '@/modules/ops/ui';

const PAGE_SIZE = 30;

function RequestForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const canManage = usePermission('ops.housekeeping.manage');
  const [f, setF] = React.useState({ location: '', kind: 'routine' as O.HkKind, priority: 'normal' as O.HkPriority, description: '', dueAt: '', assignedTo: '' });
  const save = useMutation({
    mutationFn: () =>
      api.ops.housekeeping.create(checked(O.createHkTaskSchema, {
        location: f.location.trim(),
        kind: f.kind,
        priority: f.priority,
        description: opt(f.description),
        assignedTo: canManage ? opt(f.assignedTo) : undefined,
        dueAt: f.dueAt ? new Date(f.dueAt).toISOString() : undefined,
      })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] });
      onDone();
    },
  });
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>New housekeeping request</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="sm:col-span-4">
            <ErrorBox error={save.error ? errorMessage(save.error) : null} />
          </div>
          <Field id="hk-loc" label="Location *" className="sm:col-span-2">
            <Input id="hk-loc" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="e.g. Ward 3 / Bed 7, OPD washroom" required />
          </Field>
          <Field id="hk-kind" label="Type">
            <Select id="hk-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as O.HkKind })}>
              {O.HK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {HK_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="hk-pri" label="Priority">
            <Select id="hk-pri" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as O.HkPriority })}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
            </Select>
          </Field>
          <Field id="hk-desc" label="Description" className="sm:col-span-2">
            <Input id="hk-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
          <Field id="hk-due" label="Due by (optional)">
            <Input id="hk-due" type="datetime-local" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} />
          </Field>
          {canManage && (
            <Field id="hk-assign" label="Assign to">
              <Input id="hk-assign" value={f.assignedTo} onChange={(e) => setF({ ...f, assignedTo: e.target.value })} placeholder="Staff name" />
            </Field>
          )}
          <div className="flex justify-end gap-2 sm:col-span-4">
            <Button type="button" variant="outline" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              Raise request
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function AssignRow({ task, onDone }: { task: O.HkTask; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = React.useState(task.assignedTo ?? '');
  const save = useMutation({
    mutationFn: () => api.ops.housekeeping.update(task.id, { assignedTo: name.trim() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] });
      onDone();
    },
  });
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field id={`as-${task.id}`} label="Assign to *" className="w-64">
        <Input id={`as-${task.id}`} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      <Button type="button" variant="outline" size="sm" onClick={onDone}>
        Back
      </Button>
      <Button type="submit" size="sm" disabled={save.isPending}>
        {save.isPending && <Loader2 className="animate-spin" />}
        Assign
      </Button>
      {save.error && <ErrorBox error={errorMessage(save.error)} />}
    </form>
  );
}

export default function HousekeepingPage() {
  const canRead = usePermission('ops.housekeeping.read');
  const canManage = usePermission('ops.housekeeping.manage');
  const queryClient = useQueryClient();
  const [requesting, setRequesting] = React.useState(false);
  const [status, setStatus] = React.useState('open');
  const [kind, setKind] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [assigning, setAssigning] = React.useState<string | null>(null);

  const query: O.HkTaskQuery = {
    open: status === 'open' ? 'true' : undefined,
    status: status && status !== 'open' ? (status as O.HkStatus) : undefined,
    kind: (kind || undefined) as O.HkKind | undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ['ops', 'housekeeping', query],
    queryFn: () => api.ops.housekeeping.list(query),
    placeholderData: keepPreviousData,
    enabled: canRead,
    refetchInterval: 60_000,
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: O.UpdateHkTask }) => api.ops.housekeeping.update(id, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['ops'] }),
  });

  if (!canRead) return <NoAccess />;

  const act = (t: O.HkTask, next: O.UpdateHkTask['status'], confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return;
    update.mutate({ id: t.id, body: { status: next } });
  };

  return (
    <>
      <PageHeader
        title="Housekeeping"
        description="Cleaning requests from wards and departments, assignment, completion and supervisor verification."
        actions={
          <Can permission="ops.housekeeping.request">
            <Button onClick={() => setRequesting(true)}>
              <Plus /> New request
            </Button>
          </Can>
        }
      />

      {requesting && <RequestForm onDone={() => setRequesting(false)} />}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <Select
            className="w-48"
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="open">Open (not closed)</option>
            <option value="">All statuses</option>
            {O.HK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {HK_STATUS[s].label}
              </option>
            ))}
          </Select>
          <Select
            className="w-48"
            aria-label="Type"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All types</option>
            {O.HK_KINDS.map((k) => (
              <option key={k} value={k}>
                {HK_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
          {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
        {update.error && (
          <div className="p-4 pb-0">
            <ErrorBox error={errorMessage(update.error)} />
          </div>
        )}
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Task</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Due</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <MessageRow cols={7}>Loading…</MessageRow>
              ) : data.items.length === 0 ? (
                <MessageRow cols={7}>No housekeeping tasks.</MessageRow>
              ) : (
                data.items.map((t) => {
                  const open = t.status === 'pending' || t.status === 'in_progress';
                  return (
                    <React.Fragment key={t.id}>
                      <TableRow className={t.overdue ? 'bg-destructive/5' : undefined}>
                        <TableCell>
                          <div className="font-mono text-xs">{t.number}</div>
                          <div className="text-xs text-muted-foreground">{formatDateTime(t.createdAt)}</div>
                          {t.requestedBy && <div className="text-xs text-muted-foreground">by {t.requestedBy}</div>}
                        </TableCell>
                        <TableCell className="max-w-xs whitespace-normal">
                          <div className="font-medium">{t.location}</div>
                          {t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}
                          {t.remarks && <div className="text-xs text-muted-foreground">Remarks: {t.remarks}</div>}
                        </TableCell>
                        <TableCell>
                          <div>{HK_KIND_LABELS[t.kind]}</div>
                          <PriorityBadge p={t.priority} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge s={HK_STATUS[t.status]} /> {t.overdue && <Badge variant="destructive">Overdue</Badge>}
                          {t.verifiedBy && <div className="text-xs text-muted-foreground">Verified by {t.verifiedBy}</div>}
                        </TableCell>
                        <TableCell>{t.assignedTo ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                        <TableCell className="text-xs">
                          {formatDateTime(t.dueAt)}
                          {t.doneAt && <div className="text-muted-foreground">Done {formatDateTime(t.doneAt)}</div>}
                        </TableCell>
                        <TableCell className="text-right">
                          {canManage && (
                            <div className="flex justify-end gap-1">
                              {open && (
                                <Button size="sm" variant="ghost" onClick={() => setAssigning(assigning === t.id ? null : t.id)}>
                                  {t.assignedTo ? 'Reassign' : 'Assign'}
                                </Button>
                              )}
                              {t.status === 'pending' && (
                                <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => act(t, 'in_progress')}>
                                  Start
                                </Button>
                              )}
                              {open && (
                                <Button size="sm" disabled={update.isPending} onClick={() => act(t, 'done')}>
                                  Done
                                </Button>
                              )}
                              {t.status === 'done' && (
                                <Button size="sm" disabled={update.isPending} onClick={() => act(t, 'verified')}>
                                  Verify
                                </Button>
                              )}
                              {open && (
                                <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => act(t, 'cancelled', `Cancel task ${t.number}?`)}>
                                  Cancel
                                </Button>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                      {assigning === t.id && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={7}>
                            <AssignRow task={t} onDone={() => setAssigning(null)} />
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
        <Pager data={data} page={page} setPage={setPage} />
      </Card>
    </>
  );
}
