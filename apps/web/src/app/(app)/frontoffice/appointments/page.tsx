'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2, Plus, UserPlus, X } from 'lucide-react';
import { frontoffice as fo, type Patient } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  BookingDateInput,
  DoctorSelect,
  ErrorBox,
  PatientPicker,
  SlotPicker,
  StatusBadge,
  bookingDateError,
  dateTimeOf,
  istDateOf,
  istToday,
  isValidDate,
  label,
  longDate,
  shiftDate,
  timeOf,
} from '@/modules/frontoffice/ui';
import { QuickRegister, formFromSearch, type PatientForm } from '@/modules/frontoffice/patient-form';
import { CheckInCollect } from '@/modules/frontoffice/billing';

export default function AppointmentsPage() {
  return (
    <React.Suspense>
      <Appointments />
    </React.Suspense>
  );
}

function Appointments() {
  const canRead = usePermission('frontoffice.appointment.read');
  const canUpdate = usePermission('frontoffice.appointment.update');
  const canCheckIn = usePermission('frontoffice.queue.manage');
  const queryClient = useQueryClient();
  // ?patientId=… opens the booking form for that patient (the link shown right after registration).
  const preselectId = useSearchParams().get('patientId');
  const [date, setDate] = React.useState(istToday());
  const [doctorId, setDoctorId] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [booking, setBooking] = React.useState(!!preselectId);
  const [rescheduling, setRescheduling] = React.useState<fo.Appointment | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [checkedIn, setCheckedIn] = React.useState<fo.Visit | null>(null);

  const { data, error } = useQuery({
    queryKey: ['frontoffice', 'appointments', { date, doctorId, status }],
    queryFn: () =>
      api.frontoffice.appointments.list({ date, doctorId: doctorId || undefined, status: (status || undefined) as fo.AppointmentStatus, pageSize: 200 }),
    enabled: canRead && isValidDate(date),
    refetchInterval: 30_000,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['frontoffice'] });

  const act = useMutation({
    mutationFn: async ({ a, kind }: { a: fo.Appointment; kind: 'checkin' | 'cancel' | 'noshow' }) => {
      if (kind === 'checkin') {
        const v = await api.frontoffice.appointments.checkIn(a.id);
        setCheckedIn(v);
        return `Checked in ${a.patient?.name ?? ''}: token ${v.tokenNo}`;
      }
      if (kind === 'cancel') {
        const reason = window.prompt('Reason for cancelling?');
        if (!reason) return null;
        await api.frontoffice.appointments.cancel(a.id, { reason });
        return `Cancelled ${a.appointmentNo}`;
      }
      await api.frontoffice.appointments.noShow(a.id);
      return `Marked ${a.appointmentNo} as no-show`;
    },
    onSuccess: (msg) => {
      if (msg) setNotice(msg);
      refresh();
    },
  });

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Appointments"
        description="Book, reschedule, cancel and check in."
        actions={
          <Can permission="frontoffice.appointment.create">
            <Button onClick={() => setBooking(true)}>
              <Plus /> Book appointment
            </Button>
          </Can>
        }
      />

      {booking && (
        <BookCard
          defaultDate={isValidDate(date) && date >= istToday() ? date : istToday()}
          defaultDoctorId={doctorId}
          defaultPatientId={preselectId}
          onClose={() => setBooking(false)}
          onBooked={(a) => {
            setBooking(false);
            // Jump to the day it landed on so the new appointment is visible in the list.
            setDate(istDateOf(a.slotStart));
            setNotice(`Booked ${a.appointmentNo} for ${a.patient?.name} on ${dateTimeOf(a.slotStart)}`);
            refresh();
          }}
        />
      )}
      {rescheduling && (
        <RescheduleCard
          appointment={rescheduling}
          onClose={() => setRescheduling(null)}
          onDone={(a) => {
            setRescheduling(null);
            setDate(istDateOf(a.slotStart));
            setNotice(`Moved ${a.appointmentNo} to ${dateTimeOf(a.slotStart)}`);
            refresh();
          }}
        />
      )}

      {notice && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          {notice}
          <button aria-label="Dismiss" onClick={() => setNotice(null)}>
            <X className="size-4" />
          </button>
        </div>
      )}
      {checkedIn && (
        <div className="mb-4 max-w-xl">
          <CheckInCollect key={checkedIn.id} visit={checkedIn} onDone={() => setCheckedIn(null)} />
        </div>
      )}
      {act.error && (
        <div className="mb-4">
          <ErrorBox error={act.error} />
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b p-4">
          <div>
            <Label htmlFor="a-date">Date</Label>
            <div className="mt-1 flex items-center gap-1">
              <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => setDate((d) => shiftDate(isValidDate(d) ? d : istToday(), -1))}>
                <ChevronLeft />
              </Button>
              <Input id="a-date" type="date" className="w-40" value={date} onChange={(e) => setDate(e.target.value)} />
              <Button variant="outline" size="icon" aria-label="Next day" onClick={() => setDate((d) => shiftDate(isValidDate(d) ? d : istToday(), 1))}>
                <ChevronRight />
              </Button>
              {date !== istToday() && (
                <Button variant="ghost" size="sm" onClick={() => setDate(istToday())}>
                  Today
                </Button>
              )}
            </div>
            <p className={`mt-1 text-xs ${isValidDate(date) ? 'text-muted-foreground' : 'text-destructive'}`}>
              {isValidDate(date) ? longDate(date) : 'Enter a valid date'}
            </p>
          </div>
          <div className="w-56">
            <Label htmlFor="a-doctor">Doctor</Label>
            <div className="mt-1">
              <DoctorSelect id="a-doctor" value={doctorId} onChange={setDoctorId} allowAll />
            </div>
          </div>
          <div className="w-44">
            <Label htmlFor="a-status">Status</Label>
            <Select id="a-status" className="mt-1" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {fo.APPOINTMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </Select>
          </div>
          {data && <span className="ml-auto text-sm text-muted-foreground">{data.total} appointments</span>}
        </div>

        {!isValidDate(date) ? (
          <p className="p-6 text-sm text-muted-foreground">Pick a date to see its appointments.</p>
        ) : error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Time</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Doctor</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No appointments on {longDate(date)}.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="tabular-nums">
                      {timeOf(a.slotStart)}
                      <div className="font-mono text-xs text-muted-foreground">{a.appointmentNo}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{a.patient?.name}</div>
                      <div className="text-xs text-muted-foreground">
                        <span className="font-mono">{a.patient?.uhid}</span> · {a.patient?.mobile ?? '—'}
                      </div>
                    </TableCell>
                    <TableCell>{a.doctorName}</TableCell>
                    <TableCell>
                      {label(a.type)}
                      {a.rescheduleCount > 0 && <div className="text-xs text-muted-foreground">Rescheduled ×{a.rescheduleCount}</div>}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={a.status} />
                      {a.cancelReason && <div className="text-xs text-muted-foreground">{a.cancelReason}</div>}
                    </TableCell>
                    <TableCell className="text-right">
                      {a.status === 'booked' && (
                        <div className="flex justify-end gap-1">
                          {canCheckIn && date === istToday() && (
                            <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ a, kind: 'checkin' })}>
                              Check in
                            </Button>
                          )}
                          {canUpdate && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => setRescheduling(a)}>
                                Reschedule
                              </Button>
                              <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ a, kind: 'noshow' })}>
                                No-show
                              </Button>
                              <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ a, kind: 'cancel' })}>
                                Cancel
                              </Button>
                            </>
                          )}
                        </div>
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

function BookCard({
  defaultDate,
  defaultDoctorId,
  defaultPatientId,
  onClose,
  onBooked,
}: {
  defaultDate: string;
  defaultDoctorId: string;
  defaultPatientId?: string | null;
  onClose: () => void;
  onBooked: (a: fo.Appointment) => void;
}) {
  const canRegister = usePermission('core.patient.create');
  const [picked, setPicked] = React.useState<Patient | null | undefined>(undefined);
  const [registering, setRegistering] = React.useState<PatientForm | null>(null);
  const [doctorId, setDoctorId] = React.useState(defaultDoctorId);
  const [date, setDate] = React.useState(defaultDate);
  const [slotStart, setSlotStart] = React.useState('');
  const [type, setType] = React.useState<fo.AppointmentType>('new');
  const [reason, setReason] = React.useState('');
  const [tried, setTried] = React.useState(false);

  // A patient handed over in the URL is used until the user picks or clears one.
  const preselected = useQuery({
    queryKey: ['patients', defaultPatientId],
    queryFn: () => api.patients.get(defaultPatientId!),
    enabled: !!defaultPatientId,
  });
  const patient = picked === undefined ? (preselected.data ?? null) : picked;
  const setPatient = (p: Patient | null) => setPicked(p);

  const book = useMutation({
    mutationFn: () =>
      api.frontoffice.appointments.book({
        patientId: patient!.id,
        doctorId,
        slotStart,
        type,
        reason: reason.trim() || undefined,
      }),
    onSuccess: onBooked,
  });

  const problems = [
    !patient && (registering ? 'Finish registering the patient' : 'Choose or register a patient'),
    !doctorId && 'Choose a doctor',
    bookingDateError(date),
    !bookingDateError(date) && doctorId && !slotStart && 'Choose a time',
  ].filter((p): p is string => !!p);
  const submit = () => {
    setTried(true);
    if (!problems.length) book.mutate();
  };

  return (
    <Card className="mb-6">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Book appointment</CardTitle>
        <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <div className="flex items-center justify-between">
            <Label>Patient</Label>
            {canRegister && !patient && !registering && (
              <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setRegistering(formFromSearch(''))}>
                <UserPlus /> New patient
              </Button>
            )}
          </div>
          <div className="mt-1">
            {registering && !patient ? (
              <QuickRegister
                initial={registering}
                onCancel={() => setRegistering(null)}
                onCreated={(p) => {
                  setPatient(p);
                  setRegistering(null);
                }}
              />
            ) : (
              <PatientPicker
                value={patient}
                onChange={setPatient}
                onCreateNew={canRegister ? (typed) => setRegistering(formFromSearch(typed)) : undefined}
              />
            )}
          </div>
        </div>
        <div>
          <Label htmlFor="b-doctor">Doctor</Label>
          <div className="mt-1">
            <DoctorSelect
              id="b-doctor"
              value={doctorId}
              onChange={(d) => {
                setDoctorId(d);
                setSlotStart('');
              }}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="b-type">Visit type</Label>
          <Select id="b-type" className="mt-1" value={type} onChange={(e) => setType(e.target.value as fo.AppointmentType)}>
            {fo.APPOINTMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {label(t)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="b-date">Date</Label>
          <BookingDateInput
            id="b-date"
            value={date}
            onChange={(d) => {
              setDate(d);
              setSlotStart('');
            }}
          />
        </div>
        <div>
          <Label htmlFor="b-reason">Reason</Label>
          <Input id="b-reason" className="mt-1" placeholder="Optional" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Label>Time</Label>
          <div className="mt-2">
            <SlotPicker doctorId={doctorId} date={date} value={slotStart} onChange={setSlotStart} />
          </div>
        </div>
        <div className="md:col-span-2">
          <ErrorBox error={book.error} />
          {tried && problems.length > 0 && (
            <p role="alert" className="text-sm text-destructive">
              {problems.join('. ')}.
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 md:col-span-2">
          {patient && slotStart && (
            <span className="mr-auto text-sm text-muted-foreground">
              {patient.firstName} {patient.lastName} on <span className="font-medium text-foreground">{dateTimeOf(slotStart)}</span>
            </span>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={book.isPending || (tried && problems.length > 0)} onClick={submit}>
            {book.isPending && <Loader2 className="animate-spin" />}
            Book
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RescheduleCard({ appointment, onClose, onDone }: { appointment: fo.Appointment; onClose: () => void; onDone: (a: fo.Appointment) => void }) {
  const current = istDateOf(appointment.slotStart);
  const [date, setDate] = React.useState(current >= istToday() ? current : istToday());
  const [slotStart, setSlotStart] = React.useState('');
  const [doctorId, setDoctorId] = React.useState(appointment.doctorId);
  const [reason, setReason] = React.useState('');
  const save = useMutation({
    mutationFn: () =>
      api.frontoffice.appointments.reschedule(appointment.id, {
        slotStart,
        doctorId: doctorId !== appointment.doctorId ? doctorId : undefined,
        reason: reason.trim() || undefined,
      }),
    onSuccess: onDone,
  });
  return (
    <Card className="mb-6">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>
          Reschedule {appointment.appointmentNo} · {appointment.patient?.name}
        </CardTitle>
        <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-4">
        <div>
          <Label htmlFor="r-date">Date</Label>
          <BookingDateInput
            id="r-date"
            value={date}
            onChange={(d) => {
              setDate(d);
              setSlotStart('');
            }}
          />
        </div>
        <div>
          <Label htmlFor="r-doctor">Doctor</Label>
          <div className="mt-1">
            <DoctorSelect
              id="r-doctor"
              value={doctorId}
              onChange={(d) => {
                setDoctorId(d);
                setSlotStart('');
              }}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="r-reason">Reason</Label>
          <Input id="r-reason" className="mt-1" placeholder="Optional" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="md:col-span-4">
          <Label>New time</Label>
          <div className="mt-2">
            <SlotPicker doctorId={doctorId} date={date} value={slotStart} onChange={setSlotStart} />
          </div>
        </div>
        <div className="md:col-span-4">
          <ErrorBox error={save.error} />
        </div>
        <div className="flex items-center justify-end gap-2 md:col-span-4">
          <span className="mr-auto text-sm text-muted-foreground">
            Now {dateTimeOf(appointment.slotStart)}
            {slotStart && (
              <>
                {' '}
                → <span className="font-medium text-foreground">{dateTimeOf(slotStart)}</span>
              </>
            )}
          </span>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !doctorId || !slotStart || !!bookingDateError(date)} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
