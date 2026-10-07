'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import type { hr as H } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorBox, Field, minutesLabel } from '@/modules/hr/ui';

interface Form {
  id?: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: string;
  graceMinutes: string;
  color: string;
  isActive: boolean;
}
const blank: Form = { code: '', name: '', startTime: '09:00', endTime: '17:00', breakMinutes: '30', graceMinutes: '10', color: '#0ea5e9', isActive: true };

export default function ShiftsPage() {
  const canRead = usePermission('hr.roster.read');
  const canManage = usePermission('hr.roster.manage');
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<Form | null>(null);
  const { data, isPending, error } = useQuery({ queryKey: ['hr', 'shifts'], queryFn: () => api.hr.shifts.list(), enabled: canRead });
  const save = useMutation({
    mutationFn: (f: Form) => {
      const body: H.UpdateShift = {
        name: f.name,
        startTime: f.startTime,
        endTime: f.endTime,
        breakMinutes: Number(f.breakMinutes || 0),
        graceMinutes: Number(f.graceMinutes || 0),
        color: f.color || null,
        isActive: f.isActive,
      };
      return f.id ? api.hr.shifts.update(f.id, body) : api.hr.shifts.create({ ...body, code: f.code, name: f.name, startTime: f.startTime, endTime: f.endTime });
    },
    onSuccess: () => {
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ['hr'] });
    },
  });

  if (!canRead) return <NoAccess />;
  return (
    <>
      <PageHeader
        title="Shifts"
        description="Duty timings used on the roster. A shift that ends before it starts runs overnight. Grace minutes decide when a punch counts as late."
        actions={
          canManage && (
            <Button onClick={() => setForm({ ...blank })}>
              <Plus /> Add shift
            </Button>
          )
        }
      />
      {form && canManage && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{form.id ? `Edit ${form.code}` : 'New shift'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(form);
              }}
            >
              <div className="sm:col-span-4">
                <ErrorBox error={save.error ? errorMessage(save.error) : null} />
              </div>
              <Field id="code" label="Code *">
                <Input id="code" value={form.code} disabled={!!form.id} maxLength={10} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required />
              </Field>
              <Field id="name" label="Name *" className="sm:col-span-2">
                <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </Field>
              <Field id="color" label="Colour">
                <Input id="color" type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
              </Field>
              <Field id="st" label="Starts">
                <Input id="st" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} required />
              </Field>
              <Field id="et" label="Ends">
                <Input id="et" type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} required />
              </Field>
              <Field id="br" label="Break (minutes)">
                <Input id="br" type="number" min={0} max={240} value={form.breakMinutes} onChange={(e) => setForm({ ...form, breakMinutes: e.target.value })} />
              </Field>
              <Field id="gr" label="Late after (grace minutes)">
                <Input id="gr" type="number" min={0} max={120} value={form.graceMinutes} onChange={(e) => setForm({ ...form, graceMinutes: e.target.value })} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active
              </label>
              <div className="flex justify-end gap-2 sm:col-span-3">
                <Button type="button" variant="outline" onClick={() => setForm(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending && <Loader2 className="animate-spin" />} Save
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
      <Card>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Timing</TableHead>
                <TableHead>Working time</TableHead>
                <TableHead>Grace</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : (
                data.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <span className="inline-flex items-center gap-2 font-mono text-xs">
                        <span className="size-3 rounded-full" style={{ background: s.color ?? '#94a3b8' }} />
                        {s.code}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">
                      {s.name} {!s.isActive && <Badge variant="secondary">Inactive</Badge>}
                    </TableCell>
                    <TableCell>
                      {s.startTime}–{s.endTime} {s.overnight && <Badge variant="outline">overnight</Badge>}
                    </TableCell>
                    <TableCell>
                      {minutesLabel(s.durationMinutes)}
                      {s.breakMinutes ? <span className="text-muted-foreground"> (after {s.breakMinutes}m break)</span> : null}
                    </TableCell>
                    <TableCell>{s.graceMinutes}m</TableCell>
                    <TableCell className="text-right">
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setForm({
                              id: s.id, code: s.code, name: s.name, startTime: s.startTime, endTime: s.endTime, breakMinutes: String(s.breakMinutes),
                              graceMinutes: String(s.graceMinutes), color: s.color ?? '#0ea5e9', isActive: s.isActive,
                            })
                          }
                        >
                          Edit
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
    </>
  );
}
