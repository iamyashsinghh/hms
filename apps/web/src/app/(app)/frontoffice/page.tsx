'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Monitor, RefreshCw, UserPlus } from 'lucide-react';
import { frontoffice as fo, type Patient } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DoctorSelect, ErrorBox, PatientPicker, PriorityBadge, StatusBadge, istToday, label, timeOf } from '@/modules/frontoffice/ui';
import { BillLink, CheckInCollect, VisitCollect, useCanCollect } from '@/modules/frontoffice/billing';
import { PaymentStateBadge } from '@/modules/billing/collect-now';

const ACTIONS_FOR: Record<fo.VisitStatus, fo.VisitAction[]> = {
  waiting: ['call', 'start', 'skip', 'cancel'],
  called: ['start', 'call', 'skip', 'cancel'],
  in_consultation: ['complete'],
  skipped: ['requeue', 'cancel'],
  completed: [],
  cancelled: [],
};
const ACTION_LABEL: Record<fo.VisitAction, string> = {
  call: 'Call',
  start: 'Start',
  complete: 'Done',
  skip: 'Skip',
  requeue: 'Requeue',
  cancel: 'Cancel',
};

export default function QueuePage() {
  const canRead = usePermission('frontoffice.queue.read');
  const canManage = usePermission('frontoffice.queue.manage');
  const queryClient = useQueryClient();
  const [doctorId, setDoctorId] = React.useState('');
  const [date, setDate] = React.useState(istToday());
  const [room, setRoom] = React.useState('');
  const canCollect = useCanCollect();
  const [collecting, setCollecting] = React.useState<string | null>(null);

  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ['frontoffice', 'queue', { doctorId, date }],
    queryFn: () => api.frontoffice.queue({ doctorId: doctorId || undefined, date }),
    enabled: canRead,
    refetchInterval: 10_000,
  });

  const move = useMutation({
    mutationFn: ({ id, action }: { id: string; action: fo.VisitAction }) =>
      api.frontoffice.transition(id, { action, room: action === 'call' || action === 'start' ? room || undefined : undefined }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['frontoffice', 'queue'] }),
  });

  if (!canRead) return <NoAccess />;
  const s = data?.summary;
  const unpaid = (v: fo.Visit) => v.paymentState === 'pending' || v.paymentState === 'unpaid';
  const columns = 6 + (doctorId ? 0 : 1) + (canManage ? 1 : 0);

  return (
    <>
      <PageHeader
        title="OPD queue"
        description="Tokens for the day, per doctor. Refreshes every 10 seconds."
        actions={
          <>
            <Can permission="frontoffice.queue.display">
              <Link href="/frontoffice/display" className={buttonVariants({ variant: 'outline' })}>
                <Monitor /> TV display
              </Link>
            </Can>
            <Button variant="outline" onClick={() => refetch()} aria-label="Refresh">
              <RefreshCw className={isFetching ? 'animate-spin' : ''} />
            </Button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0 overflow-x-auto">
          <div className="flex flex-wrap items-end gap-3 border-b p-4">
            <div className="w-56">
              <Label htmlFor="q-doctor">Doctor</Label>
              <div className="mt-1">
                <DoctorSelect id="q-doctor" value={doctorId} onChange={setDoctorId} allowAll />
              </div>
            </div>
            <div className="w-44">
              <Label htmlFor="q-date">Date</Label>
              <Input id="q-date" type="date" className="mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            {canManage && (
              <div className="w-36">
                <Label htmlFor="q-room">Room for calls</Label>
                <Input id="q-room" className="mt-1" placeholder="e.g. Cabin 2" maxLength={40} value={room} onChange={(e) => setRoom(e.target.value)} />
              </div>
            )}
            {s && (
              <div className="ml-auto flex flex-wrap gap-3 text-sm text-muted-foreground">
                <span>Waiting <b className="text-foreground">{s.waiting}</b></span>
                <span>Called <b className="text-foreground">{s.called}</b></span>
                <span>With doctor <b className="text-foreground">{s.inConsultation}</b></span>
                <span>Done <b className="text-foreground">{s.completed}</b></span>
              </div>
            )}
          </div>
          {move.error && (
            <div className="p-4 pb-0">
              <ErrorBox error={move.error} />
            </div>
          )}
          {error ? (
            <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-16">Token</TableHead>
                  <TableHead>Patient</TableHead>
                  {!doctorId && <TableHead>Doctor</TableHead>}
                  <TableHead>Type</TableHead>
                  <TableHead>In at</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {!data ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : data.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      No tokens yet. Check in an appointment or add a walk-in.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.items.map((v) => (
                    <React.Fragment key={v.id}>
                      <TableRow className={v.status === 'completed' || v.status === 'cancelled' ? 'opacity-60' : ''}>
                        <TableCell className="text-lg font-semibold tabular-nums">{v.tokenNo}</TableCell>
                        <TableCell>
                          <div className="font-medium">{v.patient?.name ?? '—'}</div>
                          <div className="font-mono text-xs text-muted-foreground">{v.patient?.uhid}</div>
                        </TableCell>
                        {!doctorId && <TableCell>{v.doctorName}</TableCell>}
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {label(v.kind)} <PriorityBadge priority={v.priority} />
                          </div>
                        </TableCell>
                        <TableCell>{timeOf(v.checkedInAt)}</TableCell>
                        <TableCell>
                          <StatusBadge status={v.status} />
                          {v.room && <span className="ml-1 text-xs text-muted-foreground">{v.room}</span>}
                          {v.status !== 'cancelled' && (
                            <span className="ml-1">
                              <PaymentStateBadge state={v.paymentState} />
                            </span>
                          )}
                        </TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              {canCollect && v.paymentState === 'pending' && v.status !== 'cancelled' && (
                                <Button size="sm" variant="outline" onClick={() => setCollecting(collecting === v.id ? null : v.id)}>
                                  Collect
                                </Button>
                              )}
                              {ACTIONS_FOR[v.status].map((a) => {
                                // Billing rule: unpaid tokens wait until the consultation fee is collected.
                                const held = (a === 'call' || a === 'start') && !!data.billing?.blockUnpaid && unpaid(v);
                                return (
                                  <Button
                                    key={a}
                                    size="sm"
                                    variant={a === 'cancel' || a === 'skip' ? 'ghost' : a === 'call' ? 'outline' : 'default'}
                                    disabled={move.isPending || held}
                                    title={held ? 'Collect the consultation fee first' : undefined}
                                    onClick={() => move.mutate({ id: v.id, action: a })}
                                  >
                                    {ACTION_LABEL[a]}
                                  </Button>
                                );
                              })}
                              <BillLink patientId={v.patientId} />
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                      {collecting === v.id && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={columns}>
                            <VisitCollect patientId={v.patientId} visitId={v.id} onDone={() => queryClient.invalidateQueries({ queryKey: ['frontoffice', 'queue'] })} />
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

        <Can permission="frontoffice.queue.manage">
          <WalkInCard defaultDoctorId={doctorId} />
        </Can>
      </div>
    </>
  );
}

function WalkInCard({ defaultDoctorId }: { defaultDoctorId: string }) {
  const queryClient = useQueryClient();
  const [patient, setPatient] = React.useState<Patient | null>(null);
  const [picked, setDoctorId] = React.useState('');
  const doctorId = picked || defaultDoctorId;
  const [priority, setPriority] = React.useState<fo.VisitPriority>('normal');
  const [issued, setIssued] = React.useState<fo.Visit | null>(null);

  const walkIn = useMutation({
    mutationFn: () => api.frontoffice.walkIn({ patientId: patient!.id, doctorId, priority }),
    onSuccess: (v) => {
      setIssued(v);
      setPatient(null);
      setPriority('normal');
      queryClient.invalidateQueries({ queryKey: ['frontoffice', 'queue'] });
    },
  });

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Add walk-in</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Patient</Label>
          <div className="mt-1">
            <PatientPicker value={patient} onChange={setPatient} />
          </div>
          <Link href="/frontoffice/register" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
            <UserPlus className="size-3" /> New patient
          </Link>
        </div>
        <div>
          <Label htmlFor="w-doctor">Doctor</Label>
          <div className="mt-1">
            <DoctorSelect id="w-doctor" value={doctorId} onChange={setDoctorId} />
          </div>
        </div>
        <div>
          <Label htmlFor="w-priority">Priority</Label>
          <Select id="w-priority" className="mt-1" value={priority} onChange={(e) => setPriority(e.target.value as fo.VisitPriority)}>
            {fo.VISIT_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {label(p)}
              </option>
            ))}
          </Select>
        </div>
        <ErrorBox error={walkIn.error} />
        <Button className="w-full" disabled={!patient || !doctorId || walkIn.isPending} onClick={() => walkIn.mutate()}>
          {walkIn.isPending && <Loader2 className="animate-spin" />}
          Issue token
        </Button>
        {issued && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-center">
            <div className="text-xs text-muted-foreground">Token for {issued.patient?.name}</div>
            <div className="text-4xl font-bold tabular-nums text-primary">{issued.tokenNo}</div>
            <div className="text-xs text-muted-foreground">
              {issued.doctorName} · {issued.visitNo}
            </div>
          </div>
        )}
        {issued && <CheckInCollect key={issued.id} visit={issued} onDone={() => queryClient.invalidateQueries({ queryKey: ['frontoffice', 'queue'] })} />}
      </CardContent>
    </Card>
  );
}
