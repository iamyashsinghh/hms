'use client';

import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Plus, X } from 'lucide-react';
import { hr as H } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { firstError, validate, type FieldErrors } from '@/lib/validate';
import { Can, usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorBox, Field, LeaveStatusBadge, todayIST } from '@/modules/hr/ui';

export default function LeavesPage() {
  const canRead = usePermission('hr.leave.read');
  const canApprove = usePermission('hr.leave.approve');
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState<H.LeaveStatus | 'all'>('pending');
  const [recording, setRecording] = React.useState(false);
  const query: H.LeaveQuery = { status, pageSize: 100 };
  const { data, isPending, error } = useQuery({ queryKey: ['hr', 'leaves', query], queryFn: () => api.hr.leaves.list(query), placeholderData: keepPreviousData, enabled: canRead });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['hr', 'leaves'] });
    queryClient.invalidateQueries({ queryKey: ['hr', 'roster'] });
    queryClient.invalidateQueries({ queryKey: ['hr', 'dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['hr', 'balances'] });
  };
  const decide = useMutation({
    mutationFn: ({ id, decision, note }: { id: string } & H.DecideLeave) => api.hr.leaves.decide(id, { decision, note }),
    onSuccess: refresh,
  });
  const cancel = useMutation({ mutationFn: (id: string) => api.hr.leaves.cancel(id), onSuccess: refresh });

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Leave"
        description="Approve staff leave requests. Approved leave is marked on the duty roster; unpaid leave is deducted in payroll."
        actions={
          canApprove && (
            <Button onClick={() => setRecording(true)}>
              <Plus /> Record leave
            </Button>
          )
        }
      />
      {recording && <RecordLeave onDone={() => setRecording(false)} />}
      <ErrorBox error={decide.error ? errorMessage(decide.error) : cancel.error ? errorMessage(cancel.error) : null} />
      <Card className="mt-4">
        <div className="flex items-center gap-3 border-b p-4">
          <Select className="w-44" value={status} aria-label="Status" onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="pending">Waiting for approval</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All requests</option>
          </Select>
        </div>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Staff</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No leave requests here.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <span className="font-medium">{l.employeeName}</span> <span className="font-mono text-xs text-muted-foreground">{l.employeeCode}</span>
                    </TableCell>
                    <TableCell>
                      {l.leaveTypeName} {!l.isPaid && <Badge variant="outline">unpaid</Badge>}
                    </TableCell>
                    <TableCell>
                      {formatDate(l.fromDate)}
                      {l.toDate !== l.fromDate && ` – ${formatDate(l.toDate)}`}
                      {l.halfDay && ' (half day)'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.days}</TableCell>
                    <TableCell className="max-w-56 truncate" title={l.reason ?? ''}>
                      {l.reason ?? '—'}
                      {l.decisionNote && <div className="text-xs text-muted-foreground">Note: {l.decisionNote}</div>}
                    </TableCell>
                    <TableCell>
                      <LeaveStatusBadge status={l.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {canApprove && l.status === 'pending' && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => decide.mutate({ id: l.id, decision: 'approved' })} disabled={decide.isPending}>
                            <Check /> Approve
                          </Button>{' '}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const note = window.prompt('Reason for rejecting (shown to the staff member)');
                              if (note !== null) decide.mutate({ id: l.id, decision: 'rejected', note: note || undefined });
                            }}
                            disabled={decide.isPending}
                          >
                            <X /> Reject
                          </Button>
                        </>
                      )}
                      {canApprove && l.status === 'approved' && (
                        <Button size="sm" variant="ghost" onClick={() => window.confirm('Cancel this approved leave?') && cancel.mutate(l.id)}>
                          Cancel
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>
      <Can permission="hr.leave.manage">
        <LeaveTypes />
      </Can>
    </>
  );
}

function RecordLeave({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const { data: staff } = useQuery({ queryKey: ['hr', 'employees', { status: 'current', pageSize: 500 }], queryFn: () => api.hr.employees.list({ status: 'current', pageSize: 500 }) });
  const { data: types } = useQuery({ queryKey: ['hr', 'leave-types'], queryFn: () => api.hr.leaveTypes.list() });
  const [f, setF] = React.useState({ employeeId: '', leaveTypeId: '', fromDate: todayIST(), toDate: todayIST(), halfDay: false, reason: '', autoApprove: true });
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const body = () => ({ ...f, toDate: f.halfDay ? f.fromDate : f.toDate, reason: f.reason || undefined });
  const save = useMutation({
    mutationFn: () => api.hr.leaves.create(body()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr'] });
      onDone();
    },
  });
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Record leave for a staff member</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            const r = validate(H.createLeaveSchema, body());
            setErrors(r.errors ?? {});
            if (!r.errors) save.mutate();
          }}
        >
          <div className="sm:col-span-4">
            <ErrorBox error={save.error ? errorMessage(save.error) : errors.halfDay ?? null} />
          </div>
          <Field id="emp" label="Staff *" className="sm:col-span-2" error={errors.employeeId && 'Pick a staff member'}>
            <Select id="emp" value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })} required>
              <option value="">Choose…</option>
              {staff?.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName} ({s.employeeCode})
                </option>
              ))}
            </Select>
          </Field>
          <Field id="type" label="Leave type *" className="sm:col-span-2" error={errors.leaveTypeId}>
            <Select id="type" value={f.leaveTypeId} onChange={(e) => setF({ ...f, leaveTypeId: e.target.value })} required>
              <option value="">Choose…</option>
              {types
                ?.filter((t) => t.isActive)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field id="from" label="From" error={errors.fromDate}>
            <Input id="from" type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value, toDate: e.target.value > f.toDate ? e.target.value : f.toDate })} required />
          </Field>
          <Field id="to" label="To" error={errors.toDate}>
            <Input id="to" type="date" min={f.fromDate} value={f.halfDay ? f.fromDate : f.toDate} disabled={f.halfDay} onChange={(e) => setF({ ...f, toDate: e.target.value })} required />
          </Field>
          <Field id="reason" label="Reason" className="sm:col-span-2" error={errors.reason}>
            <Input id="reason" maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.halfDay} onChange={(e) => setF({ ...f, halfDay: e.target.checked, toDate: f.fromDate })} /> Half day
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.autoApprove} onChange={(e) => setF({ ...f, autoApprove: e.target.checked })} /> Approve now
          </label>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />} Save
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function LeaveTypes() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['hr', 'leave-types'], queryFn: () => api.hr.leaveTypes.list() });
  const [f, setF] = React.useState({ code: '', name: '', annualQuota: '0', isPaid: true });
  const [typeError, setTypeError] = React.useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api.hr.leaveTypes.create({ code: f.code, name: f.name, annualQuota: Number(f.annualQuota), isPaid: f.isPaid }),
    onSuccess: () => {
      setF({ code: '', name: '', annualQuota: '0', isPaid: true });
      queryClient.invalidateQueries({ queryKey: ['hr', 'leave-types'] });
    },
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: H.UpdateLeaveType }) => api.hr.leaveTypes.update(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hr', 'leave-types'] }),
  });
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Leave types and yearly quota</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ErrorBox error={typeError ?? (create.error ? errorMessage(create.error) : update.error ? errorMessage(update.error) : null)} />
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Days per year</TableHead>
              <TableHead>Paid</TableHead>
              <TableHead>Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-mono text-xs">{t.code}</TableCell>
                <TableCell>
                  <Input
                    key={t.name}
                    className="h-8 w-48"
                    maxLength={60}
                    defaultValue={t.name}
                    aria-label={`${t.code} name`}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (!name) e.target.value = t.name;
                      else if (name !== t.name) update.mutate({ id: t.id, body: { name } });
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    step="0.5"
                    className="h-8 w-24"
                    defaultValue={t.annualQuota}
                    disabled={!t.isPaid}
                    onBlur={(e) => {
                      const q = Number(e.target.value);
                      // Whole or half days, 0-365 (same rule as the server).
                      if (e.target.value === '' || !Number.isFinite(q) || q < 0 || q > 365 || (q * 2) % 1 !== 0) e.target.value = String(t.annualQuota);
                      else if (q !== t.annualQuota) update.mutate({ id: t.id, body: { annualQuota: q } });
                    }}
                    aria-label={`${t.name} quota`}
                  />
                </TableCell>
                <TableCell>{t.isPaid ? 'Paid' : 'Unpaid (loss of pay)'}</TableCell>
                <TableCell>
                  <input type="checkbox" checked={t.isActive} onChange={(e) => update.mutate({ id: t.id, body: { isActive: e.target.checked } })} aria-label={`${t.name} active`} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const r = validate(H.leaveTypeInputSchema, { code: f.code, name: f.name, annualQuota: f.annualQuota, isPaid: f.isPaid });
            setTypeError(firstError(r.errors));
            if (!r.errors) create.mutate();
          }}
        >
          <Field id="lt-code" label="Code">
            <Input id="lt-code" className="w-24" value={f.code} maxLength={10} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} required />
          </Field>
          <Field id="lt-name" label="Name">
            <Input id="lt-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Maternity leave" required />
          </Field>
          <Field id="lt-q" label="Days per year">
            <Input id="lt-q" type="number" min={0} max={365} step="0.5" className="w-24" value={f.annualQuota} onChange={(e) => setF({ ...f, annualQuota: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={f.isPaid} onChange={(e) => setF({ ...f, isPaid: e.target.checked })} /> Paid
          </label>
          <Button type="submit" variant="outline" disabled={create.isPending}>
            <Plus /> Add type
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
