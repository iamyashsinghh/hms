'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Loader2, Star } from 'lucide-react';
import type { portal } from '@hms/shared';
import { errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { patientApi } from '../patient-session';
import { Empty, formatDateTime, StatusBadge } from './shared';

export function AppointmentsTab({ patientId, onBook }: { patientId: string; onBook: () => void }) {
  const qc = useQueryClient();
  const [scope, setScope] = React.useState<'upcoming' | 'past'>('upcoming');
  const { data, isPending, error } = useQuery({
    queryKey: ['portal', 'appointments', patientId, scope],
    queryFn: () => patientApi.portal.appointments({ patientId: patientId || undefined, scope }),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => patientApi.portal.cancelAppointment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal', 'appointments'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border bg-card p-1 text-sm">
          {(['upcoming', 'past'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`rounded-md px-3 py-1 capitalize ${scope === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            >
              {s}
            </button>
          ))}
        </div>
        <Button onClick={onBook}>
          <CalendarClock /> Book appointment
        </Button>
      </div>
      {cancel.error && <p className="text-sm text-destructive">{errorMessage(cancel.error)}</p>}
      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{errorMessage(error)}</p>
      ) : !data.length ? (
        <Empty>
          {scope === 'upcoming' ? 'No upcoming appointments.' : 'No past appointments.'}
        </Empty>
      ) : (
        <div className="space-y-3">
          {data.map((a) => (
            <AppointmentCard
              key={a.id}
              a={a}
              scope={scope}
              cancelling={cancel.isPending && cancel.variables === a.id}
              onCancel={() => cancel.mutate(a.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AppointmentCard({
  a,
  scope,
  cancelling,
  onCancel,
}: {
  a: portal.PortalAppointment;
  scope: string;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const [rating, setRating] = React.useState(false);
  const live = ['requested', 'booked', 'confirmed'].includes(a.status);
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="font-medium">{formatDateTime(a.slotStart)}</p>
          <p className="text-sm text-muted-foreground">
            {a.doctorName ?? 'Doctor'} · for {a.patientName}
          </p>
          {a.staffNote && <p className="mt-1 text-sm">Hospital: {a.staffNote}</p>}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={a.status} />
          {scope === 'upcoming' && live && (
            <Button variant="outline" size="sm" onClick={onCancel} disabled={cancelling}>
              {cancelling && <Loader2 className="animate-spin" />} Cancel
            </Button>
          )}
          {scope === 'past' && a.status !== 'cancelled' && a.status !== 'rejected' && (
            <Button variant="ghost" size="sm" onClick={() => setRating((r) => !r)}>
              <Star /> Rate visit
            </Button>
          )}
        </div>
        {rating && (
          <FeedbackForm
            patientId={a.patientId}
            appointmentRequestId={a.id}
            onDone={() => setRating(false)}
          />
        )}
      </CardContent>
    </Card>
  );
}

export function FeedbackForm({
  patientId,
  appointmentRequestId,
  onDone,
}: {
  patientId: string;
  appointmentRequestId?: string;
  onDone?: () => void;
}) {
  const [stars, setStars] = React.useState(0);
  const [comment, setComment] = React.useState('');
  const send = useMutation({
    mutationFn: () =>
      patientApi.portal.feedback({
        patientId,
        appointmentRequestId,
        rating: stars,
        comment: comment || undefined,
      }),
    onSuccess: () => onDone?.(),
  });
  if (send.isSuccess)
    return <p className="w-full text-sm text-accent-foreground">Thank you for your feedback.</p>;
  return (
    <div className="w-full space-y-2 border-t pt-3">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" aria-label={`${n} stars`} onClick={() => setStars(n)}>
            <Star
              className={`size-6 ${n <= stars ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'}`}
            />
          </button>
        ))}
      </div>
      <textarea
        className="w-full rounded-md border border-input bg-background p-2 text-sm"
        rows={2}
        maxLength={2000}
        placeholder="Tell us about your visit (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      {send.error && <p className="text-sm text-destructive">{errorMessage(send.error)}</p>}
      <Button size="sm" disabled={!stars || send.isPending} onClick={() => send.mutate()}>
        Send feedback
      </Button>
    </div>
  );
}
