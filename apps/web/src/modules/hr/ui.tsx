'use client';

// HR UI helpers shared by the screens in src/app/(app)/hr.
import * as React from 'react';
import type { hr as H } from '@hms/shared';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
export const formatINR = (v: number | null | undefined) => (v == null ? '—' : inr.format(v));

export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
export const thisMonth = () => todayIST().slice(0, 7);

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

export const shortDay = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });

export const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—';

/** HH:MM in India, for time inputs. */
export const hhmm = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '';

export const minutesLabel = (m: number | null | undefined) => (m == null ? '—' : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`);

export const CATEGORY_LABELS: Record<H.EmployeeCategory, string> = {
  doctor: 'Doctor',
  nurse: 'Nurse',
  technician: 'Technician',
  pharmacist: 'Pharmacist',
  admin: 'Admin / office',
  support: 'Support staff',
  other: 'Other',
};

export const EMPLOYMENT_LABELS: Record<H.EmploymentType, string> = {
  permanent: 'Permanent',
  contract: 'Contract',
  consultant: 'Consultant',
  trainee: 'Trainee',
  intern: 'Intern',
};

export const LICENCE_LABELS: Record<H.LicenceKind, string> = {
  medical_registration: 'Medical council registration',
  nursing_registration: 'Nursing council registration',
  pharmacy_registration: 'Pharmacy council registration',
  paramedical_registration: 'Paramedical registration',
  bls: 'BLS certificate',
  acls: 'ACLS certificate',
  radiation_safety: 'Radiation safety (AERB)',
  other: 'Other',
};

export const ATTENDANCE_LABELS: Record<H.AttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  half_day: 'Half day',
  leave: 'On leave',
  off: 'Weekly off',
  holiday: 'Holiday',
};

export function EmployeeStatusBadge({ status }: { status: H.EmployeeStatus }) {
  if (status === 'exited') return <Badge variant="secondary">Exited</Badge>;
  if (status === 'on_notice') return <Badge variant="outline">On notice</Badge>;
  return <Badge variant="accent">Active</Badge>;
}

export function LeaveStatusBadge({ status }: { status: H.LeaveStatus }) {
  if (status === 'approved') return <Badge variant="accent">Approved</Badge>;
  if (status === 'rejected') return <Badge variant="destructive">Rejected</Badge>;
  if (status === 'cancelled') return <Badge variant="secondary">Cancelled</Badge>;
  return <Badge variant="default">Pending</Badge>;
}

export function ExpiryBadge({ daysLeft }: { daysLeft: number | null }) {
  if (daysLeft == null) return <span className="text-muted-foreground">No expiry</span>;
  if (daysLeft < 0) return <Badge variant="destructive">Expired {-daysLeft}d ago</Badge>;
  if (daysLeft <= 30) return <Badge variant="destructive">{daysLeft}d left</Badge>;
  if (daysLeft <= 90) return <Badge variant="outline">{daysLeft}d left</Badge>;
  return <span className="text-muted-foreground">{daysLeft}d left</span>;
}

/** Small labelled field wrapper. */
export function Field({ id, label, children, className }: { id?: string; label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function ErrorBox({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {error}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: 'warn' }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === 'warn' ? 'text-destructive' : ''}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
