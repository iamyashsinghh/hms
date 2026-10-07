'use client';

import * as React from 'react';
import { use } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import type { setup } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth, usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { BackLink, ErrorBox, SuccessBox, WEEKDAY_LABELS, timeIST } from '@/modules/setup/ui';

type Block = { facilityId: string; weekday: number; startTime: string; endTime: string; slotMinutes: number; maxPatients?: number };

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export default function DoctorSchedulePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const canRead = usePermission('setup.doctor.read');
  const canManage = usePermission('setup.schedule.manage');
  const queryClient = useQueryClient();
  const { facility } = useAuth();

  const doctors = useQuery({ queryKey: ['setup', 'doctors', {}], queryFn: () => api.setup.listDoctors(), enabled: canRead });
  const facilities = useQuery({ queryKey: ['setup', 'facilities'], queryFn: () => api.setup.listFacilities(), enabled: canRead });
  const schedule = useQuery({ queryKey: ['setup', 'schedule', userId], queryFn: () => api.setup.getSchedule(userId), enabled: canRead });
  const leaves = useQuery({ queryKey: ['setup', 'leaves', userId], queryFn: () => api.setup.listLeaves(userId), enabled: canRead });
  const [previewDate, setPreviewDate] = React.useState(today);
  const slots = useQuery({ queryKey: ['setup', 'slots', userId, previewDate], queryFn: () => api.setup.slots(userId, { date: previewDate }), enabled: canRead && !!previewDate });

  const [edited, setEdited] = React.useState<Block[] | null>(null);
  const dirty = edited !== null;
  const blocks: Block[] = edited ?? (schedule.data ?? []).map((b) => ({ ...b, maxPatients: b.maxPatients ?? undefined }));
  const setBlocks = (fn: (b: Block[]) => Block[]) => setEdited(fn(blocks));
  const [leave, setLeave] = React.useState({ fromDate: today(), toDate: today(), reason: '' });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['setup', 'slots', userId] });
  };
  const save = useMutation({
    mutationFn: () => api.setup.saveSchedule(userId, { blocks }),
    onSuccess: (s) => {
      queryClient.setQueryData(['setup', 'schedule', userId], s);
      setEdited(null);
      refresh();
    },
  });
  const addLeave = useMutation({
    mutationFn: (body: setup.CreateLeave) => api.setup.addLeave(userId, { ...body, reason: body.reason || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup', 'leaves', userId] });
      refresh();
    },
  });
  const removeLeave = useMutation({
    mutationFn: (id: string) => api.setup.deleteLeave(userId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup', 'leaves', userId] });
      refresh();
    },
  });

  if (!canRead) return <NoAccess />;
  if (schedule.error) return <p className="text-sm text-destructive">{errorMessage(schedule.error)}</p>;

  const doctor = doctors.data?.find((d) => d.userId === userId);
  const facilityName = (id: string) => facilities.data?.find((f) => f.id === id)?.name ?? '—';
  const edit = (i: number, patch: Partial<Block>) => {
    setBlocks((b) => b.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  };
  const addBlock = (weekday: number) => {
    setBlocks((b) => [...b, { facilityId: facility?.id ?? facilities.data?.[0]?.id ?? '', weekday, startTime: '10:00', endTime: '13:00', slotMinutes: 15 }]);
  };
  const copyMonday = () => {
    const mon = blocks.filter((b) => b.weekday === 1);
    if (!mon.length) return;
    setBlocks((b) => [...b.filter((x) => x.weekday === 1 || x.weekday === 0), ...[2, 3, 4, 5, 6].flatMap((d) => mon.map((m) => ({ ...m, weekday: d })))]);
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <BackLink href="/setup/doctors" label="All doctors" />
        <PageHeader title={doctor?.name ?? 'Doctor'} description={[doctor?.departmentName, doctor?.specialization].filter(Boolean).join(' · ') || 'Weekly OPD timings'} />
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Weekly OPD timings</CardTitle>
            <CardDescription>Slots are generated from these blocks in hospital time.</CardDescription>
          </div>
          {canManage && (
            <Button variant="outline" size="sm" onClick={copyMonday} disabled={!blocks.some((b) => b.weekday === 1)}>
              Copy Monday to Tue–Sat
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <ErrorBox error={save.error} />
          {save.isSuccess && !dirty && <SuccessBox>Timings saved.</SuccessBox>}
          {WEEKDAY_LABELS.map((label, weekday) => {
            const rows = blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.weekday === weekday);
            return (
              <div key={weekday} className="grid gap-2 border-b pb-3 last:border-0 sm:grid-cols-[7rem_1fr]">
                <p className="pt-2 text-sm font-medium">{label}</p>
                <div className="space-y-2">
                  {rows.length === 0 && <p className="pt-2 text-sm text-muted-foreground">Not available</p>}
                  {rows.map(({ b, i }) => (
                    <fieldset key={i} disabled={!canManage} className="flex flex-wrap items-center gap-2">
                      <Input type="time" aria-label="From" className="w-28" value={b.startTime} onChange={(e) => edit(i, { startTime: e.target.value })} />
                      <span className="text-sm text-muted-foreground">to</span>
                      <Input type="time" aria-label="To" className="w-28" value={b.endTime} onChange={(e) => edit(i, { endTime: e.target.value })} />
                      <Select aria-label="Slot length" className="w-28" value={b.slotMinutes} onChange={(e) => edit(i, { slotMinutes: Number(e.target.value) })}>
                        {[5, 10, 15, 20, 30, 45, 60].map((m) => (
                          <option key={m} value={m}>
                            {m} min
                          </option>
                        ))}
                      </Select>
                      <Select aria-label="Facility" className="w-44" value={b.facilityId} onChange={(e) => edit(i, { facilityId: e.target.value })}>
                        {facilities.data?.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </Select>
                      <Input
                        type="number"
                        aria-label="Max patients"
                        placeholder="Max pts"
                        className="w-24"
                        min={1}
                        value={b.maxPatients ?? ''}
                        onChange={(e) => edit(i, { maxPatients: e.target.value ? Number(e.target.value) : undefined })}
                      />
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remove timing"
                          onClick={() => {
                            setBlocks((x) => x.filter((_, j) => j !== i));
                          }}
                        >
                          <X />
                        </Button>
                      )}
                    </fieldset>
                  ))}
                  {canManage && (
                    <Button variant="ghost" size="sm" onClick={() => addBlock(weekday)}>
                      <Plus /> Add timing
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {canManage && (
            <div className="flex justify-end">
              <Button onClick={() => save.mutate()} disabled={save.isPending || !dirty}>
                {save.isPending && <Loader2 className="animate-spin" />}
                Save timings
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Leaves</CardTitle>
            <CardDescription>No slots are offered on leave days.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {canManage && (
              <form
                className="grid gap-2 sm:grid-cols-[1fr_1fr]"
                onSubmit={(e) => {
                  e.preventDefault();
                  addLeave.mutate(leave);
                }}
              >
                <Input type="date" aria-label="From date" value={leave.fromDate} onChange={(e) => setLeave({ ...leave, fromDate: e.target.value })} />
                <Input type="date" aria-label="To date" value={leave.toDate} onChange={(e) => setLeave({ ...leave, toDate: e.target.value })} />
                <Input placeholder="Reason (optional)" aria-label="Reason" value={leave.reason} onChange={(e) => setLeave({ ...leave, reason: e.target.value })} />
                <Button type="submit" variant="outline" disabled={addLeave.isPending}>
                  <Plus /> Add leave
                </Button>
              </form>
            )}
            <ErrorBox error={addLeave.error ?? removeLeave.error} />
            {leaves.data?.length === 0 && <p className="text-sm text-muted-foreground">No leaves.</p>}
            <ul className="divide-y">
              {leaves.data?.map((l) => (
                <li key={l.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    {formatDate(l.fromDate)}
                    {l.toDate !== l.fromDate && ` – ${formatDate(l.toDate)}`}
                    {l.reason && <span className="text-muted-foreground"> · {l.reason}</span>}
                  </span>
                  {canManage && (
                    <Button variant="ghost" size="icon" aria-label="Delete leave" onClick={() => removeLeave.mutate(l.id)}>
                      <Trash2 />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Slot preview</CardTitle>
            <CardDescription>What reception and the patient app will see.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input type="date" aria-label="Preview date" className="w-44" value={previewDate} onChange={(e) => setPreviewDate(e.target.value)} />
            {slots.isPending ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : slots.data?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {slots.data.map((s) => (
                  <Badge key={s.start} variant="outline" title={facilityName(s.facilityId)}>
                    {timeIST(s.start)}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No slots on this date.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
