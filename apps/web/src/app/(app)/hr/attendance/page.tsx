'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';
import { hr as H } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ATTENDANCE_LABELS, ErrorBox, hhmm, minutesLabel, monthLabel, thisMonth, todayIST } from '@/modules/hr/ui';

interface Row {
  status: H.AttendanceStatus | '';
  checkIn: string;
  checkOut: string;
  remarks: string;
}

export default function AttendancePage() {
  const canRead = usePermission('hr.attendance.read');
  const [tab, setTab] = React.useState<'day' | 'month'>('day');
  if (!canRead) return <NoAccess />;
  return (
    <>
      <PageHeader
        title="Attendance"
        description="Daily muster with punches and manual marks, and the monthly summary payroll uses (absent = 1 day loss of pay, half day = 0.5)."
        actions={
          <div className="flex rounded-md border p-0.5">
            {(['day', 'month'] as const).map((t) => (
              <Button key={t} size="sm" variant={tab === t ? 'secondary' : 'ghost'} onClick={() => setTab(t)}>
                {t === 'day' ? 'Daily muster' : 'Monthly summary'}
              </Button>
            ))}
          </div>
        }
      />
      {tab === 'day' ? <DailySheet /> : <MonthSummary />}
    </>
  );
}

function DailySheet() {
  const canManage = usePermission('hr.attendance.manage');
  const queryClient = useQueryClient();
  const [date, setDate] = React.useState(todayIST());
  const [edits, setEdits] = React.useState<Record<string, Row>>({});
  const { data, isPending, error } = useQuery({ queryKey: ['hr', 'attendance', date], queryFn: () => api.hr.attendance.sheet({ date }) });

  const rowOf = (r: H.AttendanceSheetRow): Row =>
    edits[r.employee.id] ?? {
      status: r.attendance?.status ?? '',
      checkIn: hhmm(r.attendance?.checkIn),
      checkOut: hhmm(r.attendance?.checkOut),
      remarks: r.attendance?.remarks ?? '',
    };
  const edit = (r: H.AttendanceSheetRow, patch: Partial<Row>) => setEdits((x) => ({ ...x, [r.employee.id]: { ...rowOf(r), ...patch } }));

  const save = useMutation({
    mutationFn: () =>
      api.hr.attendance.mark({
        date,
        rows: Object.entries(edits)
          .filter(([, r]) => r.status)
          .map(([employeeId, r]) => ({
            employeeId,
            status: r.status as H.AttendanceStatus,
            checkIn: r.checkIn || null,
            checkOut: r.checkOut || null,
            remarks: r.remarks || null,
          })),
      }),
    onSuccess: () => {
      setEdits({});
      queryClient.invalidateQueries({ queryKey: ['hr', 'attendance'] });
      queryClient.invalidateQueries({ queryKey: ['hr', 'dashboard'] });
    },
  });

  const fillDefaults = () => {
    const next = { ...edits };
    for (const r of data ?? []) {
      if (r.attendance || next[r.employee.id]) continue;
      const kind = r.roster?.kind;
      const status: H.AttendanceStatus | '' = kind === 'shift' ? 'present' : kind === 'off' ? 'off' : kind === 'leave' ? 'leave' : kind === 'holiday' ? 'holiday' : '';
      if (status) next[r.employee.id] = { status, checkIn: '', checkOut: '', remarks: '' };
    }
    setEdits(next);
  };
  const pendingCount = Object.values(edits).filter((r) => r.status).length;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b p-4">
        <Input type="date" className="w-44" value={date} max={todayIST()} onChange={(e) => {
            setDate(e.target.value);
            setEdits({});
          }} aria-label="Date" />
        {canManage && (
          <>
            <Button variant="outline" size="sm" onClick={fillDefaults}>
              Fill from roster
            </Button>
            <Button size="sm" className="ml-auto" onClick={() => save.mutate()} disabled={!pendingCount || save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save {pendingCount ? `(${pendingCount})` : ''}
            </Button>
          </>
        )}
      </div>
      {save.error && (
        <div className="p-4">
          <ErrorBox error={errorMessage(save.error)} />
        </div>
      )}
      {error ? (
        <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Staff</TableHead>
              <TableHead>Roster</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>In</TableHead>
              <TableHead>Out</TableHead>
              <TableHead>Worked</TableHead>
              <TableHead>Late</TableHead>
              <TableHead>Remarks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  No staff on the rolls for this date.
                </TableCell>
              </TableRow>
            ) : (
              data.map((r) => {
                const row = rowOf(r);
                const working = row.status === 'present' || row.status === 'half_day';
                const a = r.attendance;
                return (
                  <TableRow key={r.employee.id} className={edits[r.employee.id] ? 'bg-primary/5' : undefined}>
                    <TableCell>
                      <div className="font-medium">{r.employee.fullName}</div>
                      <div className="text-xs text-muted-foreground">{r.employee.designation ?? r.employee.employeeCode}</div>
                    </TableCell>
                    <TableCell>
                      {r.roster ? (
                        <Badge variant={r.roster.kind === 'leave' ? 'outline' : 'secondary'}>{r.roster.kind === 'shift' ? r.roster.shiftCode : r.roster.kind}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Select className="h-8 w-32 text-xs" value={row.status} disabled={!canManage} onChange={(e) => edit(r, { status: e.target.value as H.AttendanceStatus })} aria-label="Status">
                        <option value="">Not marked</option>
                        {H.ATTENDANCE_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {ATTENDANCE_LABELS[s]}
                          </option>
                        ))}
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input type="time" className="h-8 w-28 text-xs" value={row.checkIn} disabled={!canManage || !working} onChange={(e) => edit(r, { checkIn: e.target.value })} aria-label="In" />
                    </TableCell>
                    <TableCell>
                      <Input type="time" className="h-8 w-28 text-xs" value={row.checkOut} disabled={!canManage || !working} onChange={(e) => edit(r, { checkOut: e.target.value })} aria-label="Out" />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {a?.workedMinutes != null ? minutesLabel(a.workedMinutes) : '—'}
                      {a?.overtimeMinutes ? <div className="text-xs text-muted-foreground">+{minutesLabel(a.overtimeMinutes)} OT</div> : null}
                    </TableCell>
                    <TableCell>{a?.lateMinutes ? <Badge variant="destructive">{a.lateMinutes}m</Badge> : '—'}</TableCell>
                    <TableCell>
                      <Input className="h-8 text-xs" value={row.remarks} disabled={!canManage} onChange={(e) => edit(r, { remarks: e.target.value })} aria-label="Remarks" />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function MonthSummary() {
  const [month, setMonth] = React.useState(thisMonth());
  const { data, isPending, error } = useQuery({ queryKey: ['hr', 'attendance', 'summary', month], queryFn: () => api.hr.attendance.summary(month) });
  return (
    <Card>
      <div className="flex items-center gap-3 border-b p-4">
        <Input type="month" className="w-44" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
        <span className="text-sm text-muted-foreground">{monthLabel(month)}</span>
      </div>
      {error ? (
        <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Staff</TableHead>
              <TableHead className="text-right">Present</TableHead>
              <TableHead className="text-right">Half day</TableHead>
              <TableHead className="text-right">Absent</TableHead>
              <TableHead className="text-right">Leave</TableHead>
              <TableHead className="text-right">Off / holiday</TableHead>
              <TableHead className="text-right">Late days</TableHead>
              <TableHead className="text-right">Overtime</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : (
              data.map((s) => (
                <TableRow key={s.employeeId}>
                  <TableCell>
                    <span className="font-medium">{s.fullName}</span> <span className="font-mono text-xs text-muted-foreground">{s.employeeCode}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.present}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.halfDay}</TableCell>
                  <TableCell className={`text-right tabular-nums ${s.absent ? 'text-destructive' : ''}`}>{s.absent}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.leave}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.off + s.holiday}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.lateDays}</TableCell>
                  <TableCell className="text-right tabular-nums">{minutesLabel(s.overtimeMinutes)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
