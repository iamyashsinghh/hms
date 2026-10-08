'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { portal } from '@hms/shared';
import { errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { patientApi } from '../patient-session';
import { formatDateTime, formatTime, patientName } from './shared';

/** Today's date in India as YYYY-MM-DD. */
const istDate = (offsetDays = 0) =>
  new Date(Date.now() + 330 * 60_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

export function BookTab({
  patients,
  defaultPatientId,
  onBooked,
}: {
  patients: portal.PortalPatient[];
  defaultPatientId: string;
  onBooked: () => void;
}) {
  const qc = useQueryClient();
  const [patientId, setPatientId] = React.useState(defaultPatientId || patients[0]?.id || '');
  const [doctorId, setDoctorId] = React.useState('');
  const [date, setDate] = React.useState(istDate(1));
  const [slot, setSlot] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState('');
  const dateError = !date
    ? 'Pick a date'
    : date < istDate(0)
      ? 'Pick today or a later date'
      : date > istDate(portal.PORTAL_MAX_BOOKING_DAYS)
        ? `You can book up to ${portal.PORTAL_MAX_BOOKING_DAYS} days ahead`
        : null;

  const doctors = useQuery({
    queryKey: ['portal', 'doctors'],
    queryFn: () => patientApi.portal.doctors(),
  });
  const slots = useQuery({
    queryKey: ['portal', 'slots', doctorId, date],
    queryFn: () => patientApi.portal.slots(doctorId, date),
    enabled: !!doctorId && !dateError,
  });
  const book = useMutation({
    mutationFn: () =>
      patientApi.portal.book({
        patientId,
        doctorId,
        slotStart: slot!,
        reason: reason || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal', 'appointments'] });
      qc.invalidateQueries({ queryKey: ['portal', 'slots'] });
    },
  });

  if (!patients.length)
    return (
      <p className="text-sm text-muted-foreground">Add yourself under Family first, then book.</p>
    );

  if (book.isSuccess) {
    const a = book.data;
    return (
      <Card className="mx-auto max-w-md text-center">
        <CardContent className="space-y-3 p-8">
          <CheckCircle2 className="mx-auto size-10 text-accent" />
          <p className="text-lg font-semibold">
            {a.status === 'requested' ? 'Request sent' : 'Appointment booked'}
          </p>
          <p className="text-sm text-muted-foreground">
            {a.doctorName} · {formatDateTime(a.slotStart)}
            {a.status === 'requested' && '. The hospital will confirm it shortly.'}
          </p>
          <Button onClick={onBooked}>See my appointments</Button>
        </CardContent>
      </Card>
    );
  }

  const free = (slots.data ?? []).filter((s) => s.available);
  const doctor = doctors.data?.find((d) => d.userId === doctorId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Book an appointment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="bk-patient">Patient</Label>
            <Select
              id="bk-patient"
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
            >
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {patientName(p)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bk-doctor">Doctor</Label>
            <Select
              id="bk-doctor"
              value={doctorId}
              onChange={(e) => {
                setDoctorId(e.target.value);
                setSlot(null);
              }}
            >
              <option value="">{doctors.isPending ? 'Loading…' : 'Choose a doctor'}</option>
              {doctors.data?.map((d) => (
                <option key={d.userId} value={d.userId}>
                  {d.name}
                  {d.specialization ? ` · ${d.specialization}` : ''}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bk-date">Date</Label>
            <Input
              id="bk-date"
              type="date"
              min={istDate(0)}
              max={istDate(portal.PORTAL_MAX_BOOKING_DAYS)}
              value={date}
              aria-invalid={!!dateError}
              onChange={(e) => {
                setDate(e.target.value);
                setSlot(null);
              }}
            />
            {dateError && <p className="text-xs text-destructive">{dateError}</p>}
          </div>
        </div>
        {doctor?.consultationFee != null && (
          <p className="text-sm text-muted-foreground">
            Consultation fee: ₹{doctor.consultationFee}
          </p>
        )}

        {doctorId && (
          <div className="space-y-2">
            <Label>Time</Label>
            {dateError ? (
              <p className="text-sm text-muted-foreground">Pick a valid date to see times.</p>
            ) : slots.isPending ? (
              <p className="text-sm text-muted-foreground">Loading slots…</p>
            ) : slots.error ? (
              <p className="text-sm text-destructive">{errorMessage(slots.error)}</p>
            ) : !free.length ? (
              <p className="text-sm text-muted-foreground">
                No free slots on this day. Try another date.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {free.map((s) => (
                  <button
                    key={s.start}
                    type="button"
                    onClick={() => setSlot(s.start)}
                    className={`rounded-md border px-3 py-1.5 text-sm ${slot === s.start ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                  >
                    {formatTime(s.start)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="bk-reason">Reason for visit (optional)</Label>
          <Input
            id="bk-reason"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. fever since 2 days"
          />
        </div>
        {book.error && <p className="text-sm text-destructive">{errorMessage(book.error)}</p>}
        <Button
          disabled={!patientId || !doctorId || !slot || !!dateError || book.isPending}
          onClick={() => book.mutate()}
        >
          {book.isPending && <Loader2 className="animate-spin" />} Book{' '}
          {slot ? formatDateTime(slot) : ''}
        </Button>
      </CardContent>
    </Card>
  );
}
