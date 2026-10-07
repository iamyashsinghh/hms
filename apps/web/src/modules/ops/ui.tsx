'use client';

// Facility Services UI helpers shared by the screens in src/app/(app)/ops.
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import type { ops as O, Patient } from '@hms/shared';
import { api } from '@/lib/api';
import { fullName } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TableCell, TableRow } from '@/components/ui/table';

type BadgeVariant = 'default' | 'secondary' | 'accent' | 'outline' | 'destructive';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
export const formatINR = (v: number | null | undefined) => (v == null ? '—' : inr.format(v));

export const formatDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

/** 'YYYY-MM-DD' -> '07 Oct 2026'. */
export const formatDay = (d: string | null | undefined) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/** Days from today (IST) to a 'YYYY-MM-DD' date; negative when past. */
export function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  const ms = Date.parse(`${d}T00:00:00Z`) - Date.parse(`${todayIST()}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** A date that turns red when overdue and amber within `soon` days. */
export function DueDate({ date, soon = 30 }: { date: string | null | undefined; soon?: number }) {
  const n = daysUntil(date);
  if (n == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn('whitespace-nowrap', n < 0 ? 'font-medium text-destructive' : n <= soon ? 'text-amber-700' : '')}>
      {formatDay(date)}
      {n < 0 && <span className="ml-1 text-xs">(overdue)</span>}
    </span>
  );
}

/** "snake_case" -> "Snake case". */
export const humanize = (s: string) => {
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export const ASSET_CATEGORY_LABELS: Record<O.AssetCategory, string> = {
  monitoring: 'Monitoring',
  life_support: 'Life support',
  imaging: 'Imaging',
  laboratory: 'Laboratory',
  surgical: 'Surgical',
  sterilization: 'Sterilization',
  therapy: 'Therapy',
  general: 'General',
  other: 'Other',
};

export const ASSET_STATUS: Record<O.AssetStatus, { label: string; variant: BadgeVariant }> = {
  in_service: { label: 'In service', variant: 'accent' },
  under_maintenance: { label: 'Under maintenance', variant: 'default' },
  out_of_service: { label: 'Out of service', variant: 'destructive' },
  condemned: { label: 'Condemned', variant: 'secondary' },
};

export const WO_TYPE_LABELS: Record<O.WorkOrderType, string> = { breakdown: 'Breakdown', preventive: 'Preventive (PM)', calibration: 'Calibration' };
export const WO_STATUS: Record<O.WorkOrderStatus, { label: string; variant: BadgeVariant }> = {
  open: { label: 'Open', variant: 'outline' },
  in_progress: { label: 'In progress', variant: 'default' },
  completed: { label: 'Completed', variant: 'accent' },
  cancelled: { label: 'Cancelled', variant: 'secondary' },
};

export const CSSD_STATUS: Record<O.CssdSetStatus, { label: string; variant: BadgeVariant }> = {
  dirty: { label: 'Dirty', variant: 'outline' },
  sterilizing: { label: 'Sterilizing', variant: 'default' },
  sterile: { label: 'Sterile', variant: 'accent' },
  issued: { label: 'Issued', variant: 'secondary' },
};
export const CSSD_METHOD_LABELS: Record<O.CssdMethod, string> = { steam: 'Steam (autoclave)', eto: 'ETO', plasma: 'Plasma', dry_heat: 'Dry heat' };

export const LINEN_KIND_LABELS: Record<O.LinenTxnKind, string> = {
  stock_in: 'New stock in',
  issue: 'Issue to ward',
  collect: 'Collect soiled from ward',
  laundry_out: 'Send to laundry',
  laundry_in: 'Receive from laundry',
  condemn: 'Condemn',
};

export const VEHICLE_TYPE_LABELS: Record<O.VehicleType, string> = { bls: 'BLS', als: 'ALS', patient_transport: 'Patient transport', mortuary: 'Mortuary van' };
export const VEHICLE_STATUS: Record<O.VehicleStatus, { label: string; variant: BadgeVariant }> = {
  available: { label: 'Available', variant: 'accent' },
  on_trip: { label: 'On trip', variant: 'default' },
  maintenance: { label: 'Maintenance', variant: 'outline' },
  inactive: { label: 'Inactive', variant: 'secondary' },
};
export const TRIP_KIND_LABELS: Record<O.TripKind, string> = {
  emergency_pickup: 'Emergency pickup',
  inter_hospital_transfer: 'Inter-hospital transfer',
  drop_home: 'Drop home',
  other: 'Other',
};
export const TRIP_STATUS: Record<O.TripStatus, { label: string; variant: BadgeVariant }> = {
  requested: { label: 'Requested', variant: 'outline' },
  dispatched: { label: 'Dispatched', variant: 'default' },
  patient_onboard: { label: 'Patient on board', variant: 'default' },
  completed: { label: 'Completed', variant: 'accent' },
  cancelled: { label: 'Cancelled', variant: 'secondary' },
};

export const DIET_LABELS: Record<O.DietType, string> = {
  normal: 'Normal',
  soft: 'Soft',
  liquid: 'Liquid',
  clear_liquid: 'Clear liquid',
  diabetic: 'Diabetic',
  renal: 'Renal',
  cardiac: 'Cardiac',
  low_salt: 'Low salt',
  high_protein: 'High protein',
  npo: 'NPO (nil by mouth)',
};
export const MEAL_LABELS: Record<O.Meal, string> = { breakfast: 'Breakfast', lunch: 'Lunch', evening_snack: 'Evening snack', dinner: 'Dinner' };

export const HK_KIND_LABELS: Record<O.HkKind, string> = {
  routine: 'Routine cleaning',
  discharge_clean: 'Discharge cleaning',
  spill: 'Spill',
  terminal_clean: 'Terminal cleaning',
  washroom: 'Washroom',
  pest_control: 'Pest control',
  other: 'Other',
};
export const HK_STATUS: Record<O.HkStatus, { label: string; variant: BadgeVariant }> = {
  pending: { label: 'Pending', variant: 'outline' },
  in_progress: { label: 'In progress', variant: 'default' },
  done: { label: 'Done', variant: 'accent' },
  verified: { label: 'Verified', variant: 'secondary' },
  cancelled: { label: 'Cancelled', variant: 'secondary' },
};

export function StatusBadge({ s }: { s: { label: string; variant: BadgeVariant } }) {
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function PriorityBadge({ p }: { p: 'low' | 'normal' | 'urgent' }) {
  if (p === 'urgent') return <Badge variant="destructive">Urgent</Badge>;
  if (p === 'low') return <Badge variant="secondary">Low</Badge>;
  return <Badge variant="outline">Normal</Badge>;
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Small labelled field wrapper. */
export function Field({ id, label, error, children, className }: { id?: string; label: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-2">{children}</div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
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

/** Full-width message row for an empty / loading table. */
export function MessageRow({ cols, children }: { cols: number; children: React.ReactNode }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={cols} className="py-10 text-center text-muted-foreground">
        {children}
      </TableCell>
    </TableRow>
  );
}

export function Pager({ data, page, setPage }: { data: { total: number; page: number; pageSize: number } | undefined; page: number; setPage: (p: number) => void }) {
  if (!data || data.total === 0) return null;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
      <span>
        {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          <ChevronLeft /> Prev
        </Button>
        <span>
          Page {page} of {pages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          Next <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

/** Simple tab strip. */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="mb-4 flex gap-1 border-b print:hidden">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={cn(
            '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
            value === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Search-and-pick a patient (name, UHID or mobile). */
export function PatientPicker({ value, onChange, label = 'Patient' }: { value: Patient | null; onChange: (p: Patient | null) => void; label?: string }) {
  const [term, setTerm] = React.useState('');
  const q = useDebounced(term.trim());
  const id = React.useId();
  const { data, isFetching } = useQuery({
    queryKey: ['patients', { q, page: 1, picker: true }],
    queryFn: () => api.patients.list({ q, pageSize: 8 }),
    enabled: !value && q.length >= 2,
  });

  if (value) {
    return (
      <div>
        <Label>{label}</Label>
        <div className="mt-2 flex items-center justify-between rounded-md border bg-muted/40 px-3 py-1.5 text-sm">
          <span>
            <span className="font-medium">{fullName(value)}</span> <span className="font-mono text-xs text-muted-foreground">{value.uhid}</span>
            {value.mobile && <span className="text-muted-foreground"> · {value.mobile}</span>}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)} aria-label="Change patient">
            <X />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative mt-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input id={id} className="pl-9" placeholder="Name, UHID or mobile…" value={term} onChange={(e) => setTerm(e.target.value)} autoComplete="off" />
      </div>
      {q.length >= 2 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-card shadow-lg">
          {isFetching && !data ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
          ) : data?.items.length ? (
            data.items.map((p) => (
              <button
                key={p.id}
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onChange(p);
                  setTerm('');
                }}
              >
                <span className="font-medium">{fullName(p)}</span> <span className="font-mono text-xs text-muted-foreground">{p.uhid}</span>
                {p.mobile && <span className="text-muted-foreground"> · {p.mobile}</span>}
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-sm text-muted-foreground">No patients found.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Optional number from a text input value. */
export const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
/** Optional string from a text input value. */
export const opt = (s: string) => (s.trim() === '' ? undefined : s.trim());
