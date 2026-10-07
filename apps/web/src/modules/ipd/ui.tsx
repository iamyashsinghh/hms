'use client';

// IPD UI helpers shared by the screens in src/app/(app)/ipd.
import * as React from 'react';
import type { ipd as I } from '@hms/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export { ErrorBox, Field, PatientPicker, formatDateTime, formatINR, todayIST } from '@/modules/billing/ui';

export const WARD_TYPE_LABELS: Record<I.WardType, string> = {
  general: 'General ward',
  semi_private: 'Semi-private',
  private: 'Private room',
  deluxe: 'Deluxe',
  icu: 'ICU',
  nicu: 'NICU',
  picu: 'PICU',
  hdu: 'HDU',
  emergency: 'Emergency',
  daycare: 'Day care',
  labour: 'Labour room',
  other: 'Other',
};

export const BED_STATUS_LABELS: Record<I.BedStatus, string> = {
  available: 'Available',
  occupied: 'Occupied',
  cleaning: 'Cleaning',
  maintenance: 'Maintenance',
  reserved: 'Reserved',
};

/** Tile colours for the bed board (light and dark). */
export const BED_STATUS_STYLES: Record<I.BedStatus, string> = {
  available: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100',
  occupied: 'border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100',
  cleaning: 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
  maintenance: 'border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
  reserved: 'border-violet-300 bg-violet-50 text-violet-950 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100',
};

export const ADMISSION_TYPE_LABELS: Record<I.AdmissionType, string> = {
  planned: 'Planned',
  emergency: 'Emergency',
  daycare: 'Day care',
  maternity: 'Maternity',
  transfer_in: 'Transfer in',
};

export const DISCHARGE_TYPE_LABELS: Record<I.DischargeType, string> = {
  normal: 'Normal (on advice)',
  lama: 'LAMA (left against advice)',
  dama: 'DAMA (discharged against advice)',
  referred: 'Referred to another hospital',
  death: 'Death',
  absconded: 'Absconded',
};

export const ROUTE_LABELS: Record<I.MedRoute, string> = {
  oral: 'Oral',
  iv: 'IV',
  im: 'IM',
  sc: 'SC',
  topical: 'Topical',
  inhalation: 'Inhalation',
  sublingual: 'Sublingual',
  rectal: 'Rectal',
  nasal: 'Nasal',
  other: 'Other',
};

export const IO_LABELS: Record<string, string> = {
  oral: 'Oral',
  iv: 'IV fluids',
  ryles: "Ryle's tube",
  urine: 'Urine',
  drain: 'Drain',
  vomit: 'Vomit',
  stool: 'Stool',
  other: 'Other',
};

export function AdmissionStatusBadge({ status }: { status: I.AdmissionStatus }) {
  if (status === 'admitted') return <Badge>Admitted</Badge>;
  if (status === 'discharged') return <Badge variant="secondary">Discharged</Badge>;
  return <Badge variant="destructive">Cancelled</Badge>;
}

export function BedStatusDot({ status, className }: { status: I.BedStatus; className?: string }) {
  return <span className={cn('inline-block size-2.5 rounded-full border', BED_STATUS_STYLES[status], className)} aria-hidden />;
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

/** "3 days" / "1 day". */
export const daysLabel = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/** Local datetime-local input value → ISO string with offset, or undefined. */
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : undefined);
