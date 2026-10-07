'use client';

import type { portal } from '@hms/shared';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/input';

export const patientName = (p: Pick<portal.PortalPatient, 'firstName' | 'lastName'>) => [p.firstName, p.lastName].filter(Boolean).join(' ');

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

export const formatTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

export const rupees = (v: string | number) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS: Record<string, { label: string; variant: 'default' | 'secondary' | 'accent' | 'outline' | 'destructive' }> = {
  requested: { label: 'Waiting for hospital', variant: 'secondary' },
  booked: { label: 'Booked', variant: 'accent' },
  confirmed: { label: 'Confirmed', variant: 'accent' },
  rejected: { label: 'Not available', variant: 'destructive' },
  cancelled: { label: 'Cancelled', variant: 'outline' },
  completed: { label: 'Visited', variant: 'default' },
  no_show: { label: 'Missed', variant: 'outline' },
  unpaid: { label: 'Unpaid', variant: 'destructive' },
  partially_paid: { label: 'Part paid', variant: 'secondary' },
  paid: { label: 'Paid', variant: 'accent' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, variant: 'outline' as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

/** "All family" or one linked patient. */
export function PatientPicker({
  patients,
  value,
  onChange,
  allowAll = true,
}: {
  patients: portal.PortalPatient[];
  value: string;
  onChange: (id: string) => void;
  allowAll?: boolean;
}) {
  if (patients.length <= 1 && allowAll) return null;
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-auto min-w-48">
      {allowAll && <option value="">Everyone in my family</option>}
      {!allowAll && !value && <option value="">Choose patient</option>}
      {patients.map((p) => (
        <option key={p.id} value={p.id}>
          {patientName(p)} ({p.relation})
        </option>
      ))}
    </Select>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{children}</p>;
}
