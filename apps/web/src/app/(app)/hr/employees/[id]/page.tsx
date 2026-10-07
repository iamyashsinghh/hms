'use client';

import * as React from 'react';
import Link from 'next/link';
import { use } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { hr as H } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmployeeForm, fromEmployee, toBody } from '@/modules/hr/employee-form';
import { CATEGORY_LABELS, EMPLOYMENT_LABELS, EmployeeStatusBadge, ErrorBox, ExpiryBadge, Field, formatINR, LICENCE_LABELS, todayIST } from '@/modules/hr/ui';

function Info({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm">{value || '—'}</dd>
    </div>
  );
}

export default function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('hr.employee.read');
  const canManage = usePermission('hr.employee.manage');
  const canPay = usePermission('hr.payroll.manage');
  const canLeave = usePermission('hr.leave.read');
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState(false);
  const key = ['hr', 'employees', id];
  const { data: e, isPending, error } = useQuery({ queryKey: key, queryFn: () => api.hr.employees.get(id), enabled: canRead });
  const { data: balances } = useQuery({ queryKey: ['hr', 'balances', id], queryFn: () => api.hr.employees.leaveBalances(id), enabled: canRead && canLeave });

  const save = useMutation({
    mutationFn: (body: H.UpdateEmployee) => api.hr.employees.update(id, body),
    onSuccess: (next) => {
      queryClient.setQueryData(key, next);
      queryClient.invalidateQueries({ queryKey: ['hr', 'employees'], refetchType: 'none' });
      setEditing(false);
    },
  });

  if (!canRead) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/hr/employees" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
        <ArrowLeft /> Employees
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            {e.fullName} <EmployeeStatusBadge status={e.status} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-mono">{e.employeeCode}</span> · {e.designation ?? CATEGORY_LABELS[e.category]}
            {e.department && ` · ${e.department}`}
          </p>
        </div>
        {canManage && !editing && (
          <div className="flex gap-2">
            {e.status === 'active' && (
              <Button variant="outline" onClick={() => save.mutate({ status: 'on_notice' })} disabled={save.isPending}>
                Mark on notice
              </Button>
            )}
            {e.status !== 'exited' ? (
              <Button
                variant="outline"
                onClick={() => {
                  const d = window.prompt('Last working day (YYYY-MM-DD)', todayIST());
                  if (d) save.mutate({ status: 'exited', dateOfExit: d });
                }}
                disabled={save.isPending}
              >
                Mark exited
              </Button>
            ) : (
              <Button variant="outline" onClick={() => save.mutate({ status: 'active', dateOfExit: null })} disabled={save.isPending}>
                Rejoin
              </Button>
            )}
            <Button onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
          </div>
        )}
      </div>
      {!editing && <ErrorBox error={save.error ? errorMessage(save.error) : null} />}

      {editing ? (
        <EmployeeForm
          initial={fromEmployee(e)}
          isNew={false}
          saving={save.isPending}
          error={save.error ? errorMessage(save.error) : null}
          onSubmit={(f) => save.mutate(toBody(f, canPay))}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <Card>
            <CardContent className="pt-6">
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-4">
                <Info label="Employment" value={EMPLOYMENT_LABELS[e.employmentType]} />
                <Info label="Joined" value={formatDate(e.dateOfJoining)} />
                <Info label="Left" value={e.dateOfExit ? formatDate(e.dateOfExit) : null} />
                <Info label="Login" value={e.userId ? 'Linked staff login' : 'No login'} />
                <Info label="Mobile" value={e.mobile} />
                <Info label="Email" value={e.email} />
                <Info label="Date of birth" value={e.dateOfBirth ? formatDate(e.dateOfBirth) : null} />
                <Info label="Emergency contact" value={[e.emergencyContactName, e.emergencyContactPhone].filter(Boolean).join(' · ')} />
                {e.salary && (
                  <>
                    <Info label="Monthly gross" value={formatINR(e.salary.monthlyGross)} />
                    <Info label="Basic · HRA · allowances" value={`${formatINR(e.salary.basic)} · ${formatINR(e.salary.hra)} · ${formatINR(e.salary.otherAllowances)}`} />
                    <Info label="PF / ESI" value={`${e.salary.pfApplicable ? 'PF' : 'No PF'} · ${e.salary.esiApplicable ? 'ESI' : 'No ESI'}`} />
                    <Info label="Bank" value={e.bank?.bankAccountNo ? `${e.bank.bankAccountNo} · ${e.bank.bankIfsc ?? ''}` : null} />
                  </>
                )}
              </dl>
            </CardContent>
          </Card>

          <Licences employeeId={id} />

          {canLeave && balances && (
            <Card>
              <CardHeader>
                <CardTitle>Leave this year</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-4">
                {balances.map((b) => (
                  <div key={b.leaveTypeId} className="rounded-md border p-3">
                    <p className="text-sm font-medium">{b.name}</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">{b.available ?? b.taken}</p>
                    <p className="text-xs text-muted-foreground">
                      {b.isPaid ? `available of ${b.quota} · ${b.taken} taken${b.pending ? ` · ${b.pending} pending` : ''}` : 'days taken (unpaid)'}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

interface LicenceForm {
  id?: string;
  kind: H.LicenceKind;
  number: string;
  issuedBy: string;
  validFrom: string;
  validUntil: string;
}

function Licences({ employeeId }: { employeeId: string }) {
  const canManage = usePermission('hr.employee.manage');
  const queryClient = useQueryClient();
  const key = ['hr', 'licences', employeeId];
  const { data } = useQuery({ queryKey: key, queryFn: () => api.hr.licences.list(employeeId) });
  const [form, setForm] = React.useState<LicenceForm | null>(null);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ['hr', 'employees', employeeId] });
    queryClient.invalidateQueries({ queryKey: ['hr', 'licences', 'expiring'] });
  };
  const save = useMutation({
    mutationFn: (f: LicenceForm) => {
      const body = { kind: f.kind, number: f.number, issuedBy: f.issuedBy || null, validFrom: f.validFrom || null, validUntil: f.validUntil || null };
      return f.id ? api.hr.licences.update(f.id, body) : api.hr.licences.add(employeeId, body);
    },
    onSuccess: () => {
      setForm(null);
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.hr.licences.remove(id), onSuccess: refresh });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Registrations and certificates</CardTitle>
        <Can permission="hr.employee.manage">
          <Button size="sm" variant="outline" onClick={() => setForm({ kind: 'medical_registration', number: '', issuedBy: '', validFrom: '', validUntil: '' })}>
            <Plus /> Add
          </Button>
        </Can>
      </CardHeader>
      {form && canManage && (
        <CardContent>
          <form
            className="grid gap-4 rounded-md border p-4 sm:grid-cols-5"
            onSubmit={(ev) => {
              ev.preventDefault();
              save.mutate(form);
            }}
          >
            <div className="sm:col-span-5">
              <ErrorBox error={save.error ? errorMessage(save.error) : null} />
            </div>
            <Field id="lk" label="Type" className="sm:col-span-2">
              <Select id="lk" value={form.kind} onChange={(ev) => setForm({ ...form, kind: ev.target.value as H.LicenceKind })}>
                {H.LICENCE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {LICENCE_LABELS[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="ln" label="Number *">
              <Input id="ln" value={form.number} onChange={(ev) => setForm({ ...form, number: ev.target.value })} required />
            </Field>
            <Field id="li" label="Issued by" className="sm:col-span-2">
              <Input id="li" value={form.issuedBy} onChange={(ev) => setForm({ ...form, issuedBy: ev.target.value })} placeholder="e.g. Maharashtra Nursing Council" />
            </Field>
            <Field id="lf" label="Valid from">
              <Input id="lf" type="date" value={form.validFrom} onChange={(ev) => setForm({ ...form, validFrom: ev.target.value })} />
            </Field>
            <Field id="lu" label="Valid until">
              <Input id="lu" type="date" value={form.validUntil} onChange={(ev) => setForm({ ...form, validUntil: ev.target.value })} />
            </Field>
            <div className="flex items-end justify-end gap-2 sm:col-span-3">
              <Button type="button" variant="outline" onClick={() => setForm(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <Loader2 className="animate-spin" />} Save
              </Button>
            </div>
          </form>
        </CardContent>
      )}
      {!data?.length ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">No licences on file. Council registrations and BLS/ACLS certificates with an expiry date show up in expiry alerts.</p>
        </CardContent>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Type</TableHead>
              <TableHead>Number</TableHead>
              <TableHead>Issued by</TableHead>
              <TableHead>Valid until</TableHead>
              <TableHead />
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((l) => (
              <TableRow key={l.id}>
                <TableCell>{LICENCE_LABELS[l.kind]}</TableCell>
                <TableCell className="font-mono text-xs">{l.number}</TableCell>
                <TableCell>{l.issuedBy ?? '—'}</TableCell>
                <TableCell>{formatDate(l.validUntil)}</TableCell>
                <TableCell>
                  <ExpiryBadge daysLeft={l.daysLeft} />
                </TableCell>
                <TableCell className="text-right">
                  {canManage && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setForm({ id: l.id, kind: l.kind, number: l.number, issuedBy: l.issuedBy ?? '', validFrom: l.validFrom ?? '', validUntil: l.validUntil ?? '' })}
                      >
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" aria-label="Delete licence" onClick={() => window.confirm('Delete this licence?') && remove.mutate(l.id)}>
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
