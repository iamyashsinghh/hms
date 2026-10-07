'use client';

import * as React from 'react';
import type { emr } from '@hms/shared';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}

const STATUS: Record<emr.EncounterStatus, { label: string; variant: 'default' | 'secondary' | 'accent' | 'outline' | 'destructive' }> = {
  waiting: { label: 'Waiting', variant: 'outline' },
  in_progress: { label: 'In consultation', variant: 'accent' },
  completed: { label: 'Signed', variant: 'default' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
};

export function StatusBadge({ status }: { status: emr.EncounterStatus }) {
  const s = STATUS[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function ageFromDob(dob: string | null | undefined): string {
  if (!dob) return '—';
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) age--;
  return `${age}y`;
}

export const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export const formatTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—';

export function vitalsLine(v: Partial<emr.Vitals> | null | undefined): string {
  if (!v) return '';
  return [
    v.bpSystolic && v.bpDiastolic ? `BP ${v.bpSystolic}/${v.bpDiastolic}` : null,
    v.pulse ? `Pulse ${v.pulse}` : null,
    v.temperatureC ? `Temp ${v.temperatureC}°C` : null,
    v.spo2 ? `SpO₂ ${v.spo2}%` : null,
    v.respRate ? `RR ${v.respRate}` : null,
    v.weightKg ? `Wt ${v.weightKg} kg` : null,
    v.heightCm ? `Ht ${v.heightCm} cm` : null,
    v.bmi ? `BMI ${v.bmi}` : null,
    v.bloodSugar ? `RBS ${v.bloodSugar}` : null,
    v.painScore != null ? `Pain ${v.painScore}/10` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export const TIMING_LABEL: Record<string, string> = {
  before_food: 'Before food',
  after_food: 'After food',
  with_food: 'With food',
  empty_stomach: 'Empty stomach',
  bedtime: 'At bedtime',
  any: '',
};
