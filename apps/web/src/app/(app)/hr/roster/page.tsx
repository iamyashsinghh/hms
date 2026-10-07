'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Copy, Loader2, Save } from 'lucide-react';
import type { hr as H } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { addDays, ErrorBox, shortDay, todayIST, weekStart } from '@/modules/hr/ui';

type CellValue = '' | 'off' | 'holiday' | `shift:${string}`;
const cellKey = (employeeId: string, date: string) => `${employeeId}|${date}`;

function valueOf(e: H.RosterEntry | undefined): CellValue | 'leave' {
  if (!e) return '';
  if (e.kind === 'shift') return `shift:${e.shiftId}`;
  return e.kind;
}

export default function RosterPage() {
  const canRead = usePermission('hr.roster.read');
  const canManage = usePermission('hr.roster.manage');
  const canSeeStaff = usePermission('hr.employee.read');
  const { facility } = useAuth();
  const queryClient = useQueryClient();
  const [start, setStartState] = React.useState(() => weekStart(todayIST()));
  const [department, setDepartmentState] = React.useState('');
  const [changes, setChanges] = React.useState<Map<string, CellValue>>(new Map());
  // Unsaved edits belong to the week and department on screen.
  const setStart = (v: string) => {
    setStartState(v);
    setChanges(new Map());
  };
  const setDepartment = (v: string) => {
    setDepartmentState(v);
    setChanges(new Map());
  };
  const [notice, setNotice] = React.useState<string | null>(null);
  const days = React.useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  const end = days[6]!;

  const key = ['hr', 'roster', start, department, facility?.id];
  const { data, isPending, error } = useQuery({
    queryKey: key,
    queryFn: () => api.hr.roster.get({ from: start, to: end, department: department || undefined }),
    enabled: canRead,
  });
  const { data: departments } = useQuery({ queryKey: ['hr', 'departments'], queryFn: () => api.hr.departments(), enabled: canRead && canSeeStaff });

  const entries = React.useMemo(() => new Map((data?.entries ?? []).map((e) => [cellKey(e.employeeId, e.date), e])), [data]);
  const shiftById = React.useMemo(() => new Map((data?.shifts ?? []).map((s) => [s.id, s])), [data]);

  const save = useMutation({
    mutationFn: () =>
      api.hr.roster.save({
        cells: [...changes.entries()].map(([k, v]) => {
          const [employeeId, date] = k.split('|') as [string, string];
          if (v === '') return { employeeId, date, kind: null };
          if (v.startsWith('shift:')) return { employeeId, date, kind: 'shift' as const, shiftId: v.slice(6) };
          return { employeeId, date, kind: v as 'off' | 'holiday' };
        }),
      }),
    onSuccess: (r) => {
      setChanges(new Map());
      setNotice(`Saved ${r.saved} cell(s)${r.cleared ? `, cleared ${r.cleared}` : ''}.`);
      queryClient.invalidateQueries({ queryKey: ['hr', 'roster'] });
      queryClient.invalidateQueries({ queryKey: ['hr', 'on-duty'] });
    },
  });
  const copy = useMutation({
    mutationFn: () => api.hr.roster.copyWeek({ fromWeekStart: addDays(start, -7), toWeekStart: start }),
    onSuccess: (r) => {
      setNotice(`Copied ${r.copied} cell(s) from last week${r.skipped ? `; kept ${r.skipped} that were already planned or on leave` : ''}.`);
      queryClient.invalidateQueries({ queryKey: ['hr', 'roster'] });
    },
  });

  if (!canRead) return <NoAccess />;

  const activeShifts = (data?.shifts ?? []).filter((s) => s.isActive);
  const countFor = (date: string, shiftId: string) =>
    (data?.employees ?? []).filter((emp) => {
      const k = cellKey(emp.id, date);
      const v = changes.has(k) ? changes.get(k) : valueOf(entries.get(k));
      return v === `shift:${shiftId}`;
    }).length;

  return (
    <>
      <PageHeader
        title="Duty roster"
        description={`Weekly shift plan${facility ? ` for ${facility.name}` : ''}. Approved leave appears automatically.`}
        actions={
          canManage && (
            <>
              <Button variant="outline" onClick={() => copy.mutate()} disabled={copy.isPending}>
                {copy.isPending ? <Loader2 className="animate-spin" /> : <Copy />} Copy last week
              </Button>
              <Button onClick={() => save.mutate()} disabled={!changes.size || save.isPending}>
                {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save {changes.size ? `(${changes.size})` : ''}
              </Button>
            </>
          )
        }
      />
      <div className="mb-4 space-y-2">
        <ErrorBox error={save.error ? errorMessage(save.error) : copy.error ? errorMessage(copy.error) : null} />
        {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <Button variant="outline" size="icon" aria-label="Previous week" onClick={() => setStart(addDays(start, -7))}>
            <ChevronLeft />
          </Button>
          <span className="min-w-56 text-center text-sm font-medium">
            {shortDay(start)} – {shortDay(end)}
          </span>
          <Button variant="outline" size="icon" aria-label="Next week" onClick={() => setStart(addDays(start, 7))}>
            <ChevronRight />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setStart(weekStart(todayIST()))}>
            This week
          </Button>
          {departments && (
            <Select className="ml-auto w-48" value={department} aria-label="Department" onChange={(e) => setDepartment(e.target.value)}>
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          )}
        </div>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : isPending ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : data.employees.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No employees to roster. Add staff under Employees first.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left">
                  <th className="sticky left-0 bg-muted/40 px-3 py-2 font-medium">Staff</th>
                  {days.map((d) => (
                    <th key={d} className={`px-2 py-2 font-medium ${d === todayIST() ? 'text-primary' : ''}`}>
                      {shortDay(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.employees.map((emp) => (
                  <tr key={emp.id} className="border-b">
                    <td className="sticky left-0 bg-card px-3 py-2">
                      <div className="font-medium">{emp.fullName}</div>
                      <div className="text-xs text-muted-foreground">{[emp.designation, emp.department].filter(Boolean).join(' · ') || emp.employeeCode}</div>
                    </td>
                    {days.map((d) => {
                      const k = cellKey(emp.id, d);
                      const entry = entries.get(k);
                      const saved = valueOf(entry);
                      const v = changes.has(k) ? changes.get(k)! : saved;
                      if (saved === 'leave' && !changes.has(k)) {
                        return (
                          <td key={d} className="px-2 py-1">
                            <span className="inline-block w-24 rounded bg-amber-100 px-2 py-1.5 text-center text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">Leave</span>
                          </td>
                        );
                      }
                      const shift = v.startsWith('shift:') ? shiftById.get(v.slice(6)) : undefined;
                      return (
                        <td key={d} className="px-2 py-1">
                          <Select
                            aria-label={`${emp.fullName} ${d}`}
                            className={`h-8 w-24 px-2 text-xs ${changes.has(k) ? 'ring-2 ring-primary/40' : ''}`}
                            style={shift?.color ? { borderLeft: `4px solid ${shift.color}` } : undefined}
                            value={v}
                            disabled={!canManage}
                            onChange={(e) => {
                              const next = new Map(changes);
                              const val = e.target.value as CellValue;
                              if (val === saved) next.delete(k);
                              else next.set(k, val);
                              setChanges(next);
                            }}
                          >
                            <option value="">—</option>
                            {activeShifts.map((s) => (
                              <option key={s.id} value={`shift:${s.id}`}>
                                {s.code} · {s.startTime}
                              </option>
                            ))}
                            <option value="off">Off</option>
                            <option value="holiday">Holiday</option>
                          </Select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {activeShifts.map((s) => (
                  <tr key={s.id} className="text-xs text-muted-foreground">
                    <td className="sticky left-0 bg-card px-3 py-1">
                      {s.code} · {s.name} ({s.startTime}–{s.endTime})
                    </td>
                    {days.map((d) => (
                      <td key={d} className="px-2 py-1 tabular-nums">
                        {countFor(d, s.id)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
