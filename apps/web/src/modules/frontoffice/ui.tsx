'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, UserPlus, X } from 'lucide-react';
import { frontoffice as fo, type Patient } from '@hms/shared';
import { api } from '@/lib/api';
import { ageOf, fullName, genderLabel } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';

/** Hospital-local (IST) calendar date, YYYY-MM-DD. */
export function istToday(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

/** Adds days to a YYYY-MM-DD date. */
export function shiftDate(d: string, days: number): string {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
}

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30 and half-typed years like 0202). */
export function isValidDate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < '1870-01-01' || d > '2999-12-31') return false;
  const x = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(x.getTime()) && x.toISOString().slice(0, 10) === d;
}

/**
 * "Thu, 15 Oct 2026" for a YYYY-MM-DD date. Shown next to date pickers because the browser's own picker
 * follows the browser language, and 10/08/2026 (US order) reads as 10 August to most of our users.
 */
export const longDate = (d: string) =>
  isValidDate(d)
    ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : '—';

/** Hospital-local (IST) calendar date of a timestamp. */
export const istDateOf = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** "Thu, 15 Oct 2026 at 11:30 am" in IST. */
export const dateTimeOf = (iso: string) => `${longDate(istDateOf(iso))} at ${timeOf(iso)}`;

/** Why a booking date is not acceptable, or null when it is. */
export function bookingDateError(d: string): string | null {
  if (!d) return 'Choose a date';
  if (!isValidDate(d)) return 'Enter a valid date';
  if (d < istToday()) return 'This date is in the past';
  if (d > shiftDate(istToday(), fo.MAX_BOOKING_DAYS_AHEAD)) return `Appointments can be booked up to ${fo.MAX_BOOKING_DAYS_AHEAD} days ahead`;
  return null;
}

/** Date picker for booking: today up to MAX_BOOKING_DAYS_AHEAD, with the chosen day spelled out under it. */
export function BookingDateInput({ id, value, onChange }: { id: string; value: string; onChange: (d: string) => void }) {
  const error = bookingDateError(value);
  return (
    <>
      <Input
        id={id}
        type="date"
        className="mt-1"
        min={istToday()}
        max={shiftDate(istToday(), fo.MAX_BOOKING_DAYS_AHEAD)}
        value={value}
        aria-invalid={!!error}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className={cn('mt-1 text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>{error ?? longDate(value)}</p>
    </>
  );
}

export const timeOf = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—';

export const label = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, ' ');

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useDoctors() {
  return useQuery({ queryKey: ['frontoffice', 'doctors'], queryFn: () => api.frontoffice.doctors(), staleTime: 5 * 60_000 });
}

export function DoctorSelect({
  value,
  onChange,
  allowAll,
  id,
}: {
  value: string;
  onChange: (id: string) => void;
  allowAll?: boolean;
  id?: string;
}) {
  const { data } = useDoctors();
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allowAll ? 'All doctors' : 'Choose doctor…'}</option>
      {data?.map((d) => (
        <option key={d.userId} value={d.userId}>
          {d.name}
        </option>
      ))}
    </Select>
  );
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'accent' | 'outline' | 'destructive'> = {
  booked: 'outline',
  waiting: 'outline',
  called: 'accent',
  checked_in: 'accent',
  in_consultation: 'default',
  completed: 'secondary',
  skipped: 'destructive',
  cancelled: 'destructive',
  no_show: 'destructive',
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? 'outline'}>{label(status)}</Badge>;
}

export function PriorityBadge({ priority }: { priority: fo.VisitPriority }) {
  if (priority === 'normal') return null;
  return <Badge variant={priority === 'urgent' ? 'destructive' : 'accent'}>{label(priority)}</Badge>;
}

/** Search patients by name, UHID or mobile and pick one. */
export function PatientPicker({
  value,
  onChange,
  placeholder = 'Search patient by name, UHID or mobile…',
  onCreateNew,
}: {
  value: Patient | null;
  onChange: (p: Patient | null) => void;
  placeholder?: string;
  /** When set, the results end with a "register a new patient" row that hands over what was typed. */
  onCreateNew?: (typed: string) => void;
}) {
  const [q, setQ] = React.useState('');
  const term = useDebounced(q.trim());
  const { data, isFetching } = useQuery({
    queryKey: ['patients', { q: term, page: 1, picker: true }],
    queryFn: () => api.patients.list({ q: term, pageSize: 8 }),
    enabled: term.length >= 2 && !value,
  });

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
        <div>
          <span className="font-medium">{fullName(value)}</span>{' '}
          <span className="font-mono text-xs text-muted-foreground">{value.uhid}</span>
          <div className="text-xs text-muted-foreground">
            {genderLabel(value.gender)} · {ageOf(value)} · {value.mobile ?? 'no mobile'}
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Clear patient" onClick={() => onChange(null)}>
          <X />
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input className="pl-9" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      {isFetching && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      {term.length >= 2 && data && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-card shadow-lg">
          {data.items.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">No patients found.</p>
          ) : (
            data.items.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onChange(p);
                  setQ('');
                }}
              >
                <span>
                  {fullName(p)} <span className="text-xs text-muted-foreground">{genderLabel(p.gender)} · {ageOf(p)}</span>
                </span>
                <span className="font-mono text-xs text-muted-foreground">{p.uhid}</span>
              </button>
            ))
          )}
          {onCreateNew && (
            <button
              type="button"
              className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm font-medium text-primary hover:bg-muted"
              onClick={() => {
                onCreateNew(q.trim());
                setQ('');
              }}
            >
              <UserPlus className="size-4" /> Register a new patient
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {msg}
    </div>
  );
}

/** IST wall-clock time now, HH:MM. */
const istNowTime = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(11, 16);

/** 10:00, or on today once that has passed, the next quarter hour (capped at 23:45). */
function defaultTime(date: string): string {
  if (date !== istToday()) return '10:00';
  const [h, m] = istNowTime().split(':').map(Number) as [number, number];
  const next = Math.min(Math.ceil((h * 60 + m + 1) / 15) * 15, 23 * 60 + 45);
  const t = `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`;
  return t > '10:00' ? t : '10:00';
}

/**
 * Picks a start time. Doctors with a setup schedule get their slots (full ones disabled); doctors without
 * one get a free time field. `value` is an ISO timestamp or ''.
 *
 * In free-time mode the value always follows the date and time on screen, so changing the date never
 * leaves the form without a time (or pointing at the previously shown day).
 */
export function SlotPicker({
  doctorId,
  date,
  value,
  onChange,
}: {
  doctorId: string;
  date: string;
  value: string;
  onChange: (iso: string) => void;
}) {
  const validDate = isValidDate(date);
  const { data, isPending } = useQuery({
    queryKey: ['frontoffice', 'slots', doctorId, date],
    queryFn: () => api.frontoffice.slots(doctorId, { date }),
    enabled: !!doctorId && validDate,
  });
  const [time, setTime] = React.useState(() => defaultTime(date));
  const freeMode = !!doctorId && validDate && !isPending && !data?.length;
  const timeError = !/^\d{2}:\d{2}$/.test(time) ? 'Enter a time' : date === istToday() && time < istNowTime() ? 'This time has already passed' : null;

  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => {
    onChangeRef.current = onChange;
  });
  React.useEffect(() => {
    if (freeMode) onChangeRef.current(timeError ? '' : new Date(`${date}T${time}:00+05:30`).toISOString());
  }, [freeMode, date, time, timeError]);

  if (!doctorId) return <p className="text-sm text-muted-foreground">Choose a doctor first.</p>;
  if (!validDate) return <p className="text-sm text-muted-foreground">Choose a valid date first.</p>;
  if (isPending) return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
  if (data && data.length) {
    return (
      <div className="flex flex-wrap gap-2">
        {data.map((s) => {
          const selected = new Date(s.start).toISOString() === value;
          return (
            <Button
              key={s.start}
              type="button"
              size="sm"
              variant={selected ? 'default' : 'outline'}
              disabled={!s.available}
              title={`${s.booked}/${s.capacity} booked`}
              onClick={() => onChange(new Date(s.start).toISOString())}
            >
              {timeOf(s.start)}
              {s.capacity > 1 && <span className="text-[10px] opacity-70">{s.capacity - s.booked} left</span>}
            </Button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Input
        type="time"
        step={300}
        className="w-36"
        aria-label="Time"
        aria-invalid={!!timeError}
        value={time}
        onChange={(e) => setTime(e.target.value)}
      />
      {timeError ? (
        <p className="text-xs text-destructive">{timeError}</p>
      ) : (
        <p className="text-xs text-muted-foreground">No schedule set up for this doctor, so any free time can be booked.</p>
      )}
    </div>
  );
}
