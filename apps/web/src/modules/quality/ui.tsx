'use client';

// Quality UI helpers shared by the screens in src/app/(app)/quality.
import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import type { Paginated, Patient, quality as Q } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { fullName } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const humanize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');

export const formatDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
export const currentPeriod = () => todayIST().slice(0, 7);
export const periodLabel = (p: string) =>
  new Date(`${p}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
/** For <input type="datetime-local">: local time without seconds. */
export const localDateTime = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export const CATEGORY_LABELS: Record<Q.IncidentCategory, string> = {
  medication_error: 'Medication error',
  adverse_drug_reaction: 'Adverse drug reaction',
  patient_fall: 'Patient fall',
  needle_stick_injury: 'Needle stick injury',
  wrong_patient: 'Wrong patient / identification',
  wrong_site_surgery: 'Wrong site / procedure',
  transfusion_reaction: 'Transfusion reaction',
  pressure_ulcer: 'Pressure ulcer',
  equipment_failure: 'Equipment failure',
  fire_safety: 'Fire / electrical safety',
  violence: 'Violence / aggression',
  documentation: 'Documentation error',
  infection_control: 'Infection control breach',
  other: 'Other',
};

export const KIND_LABELS: Record<Q.IncidentKind, string> = {
  near_miss: 'Near miss (no harm reached patient)',
  incident: 'Incident',
  adverse_event: 'Adverse event (harm caused)',
  sentinel_event: 'Sentinel event (death / serious harm)',
};

export const HAI_LABELS: Record<Q.HaiType, string> = {
  cauti: 'CAUTI (catheter urinary tract)',
  clabsi: 'CLABSI (central line bloodstream)',
  vap: 'VAP (ventilator pneumonia)',
  ssi: 'SSI (surgical site)',
  other: 'Other',
};

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  reported: 'default',
  open: 'default',
  scheduled: 'default',
  suspected: 'default',
  draft: 'secondary',
  under_review: 'secondary',
  in_progress: 'secondary',
  action_planned: 'secondary',
  completed: 'accent',
  resolved: 'accent',
  verified: 'accent',
  approved: 'accent',
  closed: 'outline',
  archived: 'outline',
  ruled_out: 'outline',
  cancelled: 'outline',
  rejected: 'outline',
  confirmed: 'destructive',
};

export function StatusBadge({ status, overdue }: { status: string; overdue?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant={STATUS_VARIANT[status] ?? 'outline'}>{humanize(status)}</Badge>
      {overdue && <Badge variant="destructive">Overdue</Badge>}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Q.IncidentSeverity }) {
  const v: BadgeProps['variant'] = severity === 'severe' || severity === 'death' ? 'destructive' : severity === 'moderate' ? 'default' : 'secondary';
  return <Badge variant={v}>{humanize(severity)}</Badge>;
}

export function Field({ id, label, children, className, hint }: { id: string; label: string; children: React.ReactNode; className?: string; hint?: string }) {
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-2">{children}</div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
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

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {errorMessage(error)}
    </div>
  );
}

export function EnumSelect<T extends string>({
  id,
  value,
  onChange,
  options,
  labels,
  placeholder,
}: {
  id?: string;
  value: T | '';
  onChange: (v: T | '') => void;
  options: readonly T[];
  labels?: Partial<Record<T, string>>;
  placeholder?: string;
}) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value as T | '')}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {labels?.[o] ?? humanize(o)}
        </option>
      ))}
    </Select>
  );
}

/** Staff picker for owners / assignees (needs quality.capa.manage). */
export function StaffSelect({ id, value, onChange, placeholder = 'Unassigned' }: { id?: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const can = usePermission('quality.capa.manage');
  const { data } = useQuery({ queryKey: ['quality', 'staff'], queryFn: () => api.quality.staff(), enabled: can, staleTime: 5 * 60_000 });
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={!can}>
      <option value="">{placeholder}</option>
      {data?.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}

/** Search a patient by name, UHID or mobile (optional link on incidents, complaints, infections). */
export function PatientPicker({ value, onChange }: { value: Q.PatientRef | null; onChange: (p: Q.PatientRef | null) => void }) {
  const [q, setQ] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data } = useQuery({
    queryKey: ['patients', { q: debounced, page: 1 }],
    queryFn: () => api.patients.list({ q: debounced, page: 1, pageSize: 8 }),
    enabled: debounced.length >= 2 && !value,
  });
  if (value) {
    return (
      <div className="flex h-9 items-center justify-between rounded-md border bg-muted/40 px-3 text-sm">
        <span>
          {value.name} <span className="font-mono text-xs text-muted-foreground">{value.uhid}</span>
        </span>
        <button type="button" aria-label="Clear patient" onClick={() => onChange(null)}>
          <X className="size-4 text-muted-foreground" />
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input className="pl-9" placeholder="Search patient by name, UHID or mobile" value={q} onChange={(e) => setQ(e.target.value)} />
      {data && data.items.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover bg-background shadow-md">
          {data.items.map((p: Patient) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onChange({ id: p.id, uhid: p.uhid, name: fullName(p) });
                  setQ('');
                }}
              >
                <span>{fullName(p)}</span>
                <span className="font-mono text-xs text-muted-foreground">{p.uhid}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Pager<T>({ data, page, setPage }: { data: Paginated<T> | undefined; page: number; setPage: (p: number) => void }) {
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

export function ActivityList({ items }: { items: Q.Activity[] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  return (
    <ol className="space-y-3 border-l pl-4">
      {items.map((a) => (
        <li key={a.id} className="text-sm">
          <div className="font-medium">
            {a.toStatus && a.action === 'status' ? `Moved to ${humanize(a.toStatus)}` : humanize(a.action)}
            <span className="ml-2 font-normal text-muted-foreground">
              {a.actor?.name ?? (a.action === 'reported' ? 'Anonymous' : 'System')} · {formatDateTime(a.createdAt)}
            </span>
          </div>
          {a.note && <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{a.note}</p>}
        </li>
      ))}
    </ol>
  );
}

export function CapaList({ items }: { items: Q.CapaSummary[] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">No corrective actions yet.</p>;
  return (
    <ul className="divide-y rounded-md border">
      {items.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
          <Link href={`/quality/capa/${c.id}`} className="font-medium text-primary hover:underline">
            {c.capaNo} · {c.title}
          </Link>
          <span className="flex items-center gap-2 text-muted-foreground">
            {c.owner?.name ?? 'No owner'} · due {c.dueDate} <StatusBadge status={c.status} overdue={c.overdue} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function KpiTile({ label, value, tone, href }: { label: string; value: number | string; tone?: 'bad' | 'good'; href?: string }) {
  const body = (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums', tone === 'bad' && 'text-destructive')}>{value}</div>
    </div>
  );
  return href ? (
    <Link href={href} className="block transition-opacity hover:opacity-80">
      {body}
    </Link>
  ) : (
    body
  );
}

export function formatIndicator(r: Pick<Q.IndicatorResult, 'value' | 'unit'>): string {
  if (r.value == null) return '—';
  if (r.unit === 'percent') return `${r.value.toFixed(1)}%`;
  if (r.unit === 'minutes') return `${r.value.toFixed(0)} min`;
  if (r.unit === 'count') return String(r.value);
  return r.value.toFixed(2);
}

export function formatTarget(r: Pick<Q.IndicatorResult, 'target' | 'unit'>, lowerIsBetter: boolean): string {
  if (r.target == null) return '—';
  const v = formatIndicator({ value: r.target, unit: r.unit });
  return `${lowerIsBetter ? '≤' : '≥'} ${v}`;
}

export function IndicatorStatus({ status }: { status: Q.IndicatorResult['status'] }) {
  if (status === 'met') return <Badge variant="accent">Met</Badge>;
  if (status === 'missed') return <Badge variant="destructive">Missed</Badge>;
  if (status === 'no_target') return <Badge variant="outline">No target</Badge>;
  return <Badge variant="secondary">No data</Badge>;
}
