'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fingerprint, Loader2 } from 'lucide-react';
import { hr as H } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/validate';
import { usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { addDays, clock, ErrorBox, Field, formatINR, LeaveStatusBadge, minutesLabel, monthLabel, shortDay, thisMonth, todayIST } from '@/modules/hr/ui';

export default function MyHrPage() {
  const canUse = usePermission('hr.self.use');
  const queryClient = useQueryClient();
  const today = todayIST();
  const { data: me, isPending, error } = useQuery({ queryKey: ['hr', 'me'], queryFn: () => api.hr.me.get(), enabled: canUse });
  const linked = !!me?.employee;
  const { data: roster } = useQuery({ queryKey: ['hr', 'me', 'roster', today], queryFn: () => api.hr.me.roster(today, addDays(today, 13)), enabled: linked });
  const { data: month } = useQuery({ queryKey: ['hr', 'me', 'attendance', thisMonth()], queryFn: () => api.hr.me.attendance(thisMonth()), enabled: linked });
  const punch = useMutation({
    mutationFn: () => api.hr.me.punch(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hr', 'me'] }),
  });

  if (!canUse) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  if (!me.employee) {
    return (
      <>
        <PageHeader title="My HR" />
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">Your login is not linked to an HR record yet. Ask HR to add you under HR → Employees.</CardContent>
        </Card>
      </>
    );
  }

  const att = me.today.attendance;
  const punchedIn = !!att?.checkIn && !att.checkOut;
  const done = !!att?.checkOut;
  const shiftLabel = me.today.shift ? `${me.today.shift.name} ${me.today.shift.startTime}–${me.today.shift.endTime}` : me.today.roster ? me.today.roster.kind : 'Not rostered';
  const shiftsById = new Map(roster?.shifts.map((s) => [s.id, s]));
  const present = month?.filter((a) => a.status === 'present' || a.status === 'half_day').length ?? 0;
  const late = month?.filter((a) => a.lateMinutes > 0).length ?? 0;

  return (
    <>
      <PageHeader title="My HR" description={`${me.employee.fullName} · ${me.employee.employeeCode}${me.employee.designation ? ` · ${me.employee.designation}` : ''}`} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Today · {formatDate(me.today.date)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm">
              Duty: <span className="font-medium capitalize">{shiftLabel}</span>
              {me.today.roster?.ward && ` · ${me.today.roster.ward}`}
            </p>
            {att && (
              <p className="text-sm text-muted-foreground">
                In {clock(att.checkIn)}
                {att.checkOut && ` · Out ${clock(att.checkOut)} · ${minutesLabel(att.workedMinutes)}`}
                {att.lateMinutes > 0 && ` · ${att.lateMinutes}m late`}
              </p>
            )}
            <ErrorBox error={punch.error ? errorMessage(punch.error) : null} />
            <Button className="w-full" size="lg" onClick={() => punch.mutate()} disabled={punch.isPending || done}>
              {punch.isPending ? <Loader2 className="animate-spin" /> : <Fingerprint />}
              {done ? 'Shift complete' : punchedIn ? 'Punch out' : 'Punch in'}
            </Button>
            <p className="text-xs text-muted-foreground">
              {monthLabel(thisMonth())}: {present} day(s) present{late ? `, ${late} late` : ''}.
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>My duty, next two weeks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-2 text-center text-xs">
              {Array.from({ length: 14 }, (_, i) => addDays(today, i)).map((d) => {
                const e = roster?.entries.find((x) => x.date === d);
                const s = e?.shiftId ? shiftsById.get(e.shiftId) : undefined;
                return (
                  <div key={d} className={`rounded-md border p-2 ${d === today ? 'border-primary' : ''}`} style={s?.color ? { borderTop: `3px solid ${s.color}` } : undefined}>
                    <div className="text-muted-foreground">{shortDay(d)}</div>
                    <div className="mt-1 font-medium capitalize">{s ? s.code : (e?.kind ?? '—')}</div>
                    {s && <div className="text-muted-foreground">{s.startTime}</div>}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <MyLeave />
        <MyPayslips />
      </div>
    </>
  );
}

function MyLeave() {
  const queryClient = useQueryClient();
  const { data: balances } = useQuery({ queryKey: ['hr', 'me', 'balances'], queryFn: () => api.hr.me.leaveBalances() });
  const { data: leaves } = useQuery({ queryKey: ['hr', 'me', 'leaves'], queryFn: () => api.hr.me.leaves() });
  const [f, setF] = React.useState({ leaveTypeId: '', fromDate: todayIST(), toDate: todayIST(), halfDay: false, reason: '' });
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['hr', 'me'] });
  const apply = useMutation({
    mutationFn: () => api.hr.me.applyLeave({ ...f, toDate: f.halfDay ? f.fromDate : f.toDate, reason: f.reason || undefined }),
    onSuccess: () => {
      setF({ leaveTypeId: '', fromDate: todayIST(), toDate: todayIST(), halfDay: false, reason: '' });
      refresh();
    },
  });
  const cancel = useMutation({ mutationFn: (id: string) => api.hr.me.cancelLeave(id), onSuccess: refresh });

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Leave</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-4">
          {balances?.map((b) => (
            <div key={b.leaveTypeId} className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">{b.name}</p>
              <p className="text-xl font-semibold tabular-nums">{b.available ?? b.taken}</p>
              <p className="text-xs text-muted-foreground">{b.isPaid ? `left of ${b.quota}` : 'taken'}</p>
            </div>
          ))}
        </div>
        <form
          className="grid gap-3 rounded-md border p-3 sm:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            const r = validate(H.applyLeaveSchema, { ...f, toDate: f.halfDay ? f.fromDate : f.toDate, reason: f.reason || undefined });
            setErrors(r.errors ?? {});
            if (!r.errors) apply.mutate();
          }}
        >
          <div className="sm:col-span-5">
            <ErrorBox error={apply.error ? errorMessage(apply.error) : errors.halfDay ?? null} />
          </div>
          <Field id="lt" label="Type" error={errors.leaveTypeId}>
            <Select id="lt" value={f.leaveTypeId} onChange={(e) => setF({ ...f, leaveTypeId: e.target.value })} required>
              <option value="">Choose…</option>
              {balances?.map((b) => (
                <option key={b.leaveTypeId} value={b.leaveTypeId}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="lf" label="From" error={errors.fromDate}>
            <Input id="lf" type="date" min={addDays(todayIST(), -30)} max={addDays(todayIST(), 366)} value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value, toDate: e.target.value > f.toDate || f.halfDay ? e.target.value : f.toDate })} required />
          </Field>
          <Field id="lto" label="To" error={errors.toDate}>
            <Input id="lto" type="date" min={f.fromDate} value={f.toDate} disabled={f.halfDay} onChange={(e) => setF({ ...f, toDate: e.target.value })} required />
          </Field>
          <Field id="lr" label="Reason" error={errors.reason}>
            <Input id="lr" maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
          </Field>
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-1 pb-2 text-xs">
              <input type="checkbox" checked={f.halfDay} onChange={(e) => setF({ ...f, halfDay: e.target.checked, toDate: f.fromDate })} /> Half day
            </label>
            <Button type="submit" disabled={apply.isPending}>
              {apply.isPending && <Loader2 className="animate-spin" />} Apply
            </Button>
          </div>
        </form>
        <ErrorBox error={cancel.error ? errorMessage(cancel.error) : null} />
        <ul className="divide-y text-sm">
          {leaves?.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {l.leaveTypeName} · {formatDate(l.fromDate)}
                {l.toDate !== l.fromDate && ` – ${formatDate(l.toDate)}`} ({l.days}d)
                {l.decisionNote && <span className="text-muted-foreground"> · {l.decisionNote}</span>}
              </span>
              <span className="flex items-center gap-2">
                <LeaveStatusBadge status={l.status} />
                {(l.status === 'pending' || (l.status === 'approved' && l.fromDate > todayIST())) && (
                  <Button size="sm" variant="ghost" onClick={() => cancel.mutate(l.id)}>
                    Cancel
                  </Button>
                )}
              </span>
            </li>
          ))}
          {leaves?.length === 0 && <li className="py-2 text-muted-foreground">No leave requests yet.</li>}
        </ul>
      </CardContent>
    </Card>
  );
}

function MyPayslips() {
  const { data } = useQuery({ queryKey: ['hr', 'me', 'payslips'], queryFn: () => api.hr.me.payslips() });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payslips</CardTitle>
      </CardHeader>
      <CardContent>
        {!data?.length ? (
          <p className="text-sm text-muted-foreground">Payslips appear here once HR finalizes payroll.</p>
        ) : (
          <ul className="divide-y text-sm">
            {data.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2">
                <span>{monthLabel(s.month)}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{formatINR(s.netPay)}</span>
                  <Link href={`/hr/me/payslips/${s.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                    View
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
