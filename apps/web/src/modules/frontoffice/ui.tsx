'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, X } from 'lucide-react';
import type { Patient, frontoffice as fo } from '@hms/shared';
import { api } from '@/lib/api';
import { ageOf, fullName, genderLabel } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';

/** Hospital-local (IST) calendar date, YYYY-MM-DD. */
export function istToday(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
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
}: {
  value: Patient | null;
  onChange: (p: Patient | null) => void;
  placeholder?: string;
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
