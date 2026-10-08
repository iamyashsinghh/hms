'use client';

// CRM UI helpers shared by the screens in src/app/(app)/crm.
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import type { Paginated, Patient, crm as C } from '@hms/shared';
import type { z } from 'zod';
import { api } from '@/lib/api';
import { fullName } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
export const formatINR = (v: number | null | undefined) => (v == null ? '—' : inr.format(v));
export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
export const addDaysISO = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const formatDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
/** ISO timestamp -> value for <input type="datetime-local"> in local time. */
export const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

export const LEAD_SOURCE_LABELS: Record<C.LeadSource, string> = {
  walk_in: 'Walk-in',
  phone: 'Phone call',
  website: 'Website',
  camp: 'Health camp',
  referral: 'Referral',
  campaign: 'Campaign',
  social: 'Social media',
  whatsapp: 'WhatsApp',
  other: 'Other',
};

export const LEAD_STATUS_LABELS: Record<C.LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Interested',
  converted: 'Converted',
  lost: 'Lost',
};

export const REFERRER_TYPE_LABELS: Record<C.ReferrerType, string> = {
  doctor: 'Doctor',
  hospital: 'Hospital',
  clinic: 'Clinic',
  agent: 'Agent',
  corporate: 'Corporate',
  staff: 'Staff',
  other: 'Other',
};

export const RULE_SCOPE_LABELS: Record<C.RuleScope, string> = {
  all: 'All bills',
  frontoffice: 'OPD / consultation',
  emr: 'EMR',
  billing: 'Billing desk',
  pharmacy: 'Pharmacy',
  lab: 'Lab',
  radiology: 'Radiology',
  ipd: 'IPD',
};

export const CAMP_TYPE_LABELS: Record<C.CampType, string> = {
  health_camp: 'Health camp',
  screening: 'Screening',
  awareness: 'Awareness',
  corporate: 'Corporate',
  school: 'School',
  other: 'Other',
};

export const FOLLOW_UP_TYPE_LABELS: Record<C.FollowUpType, string> = {
  revisit: 'Revisit',
  call: 'Call',
  feedback_recovery: 'Feedback recovery',
  test_review: 'Test review',
  other: 'Other',
};

export const FOLLOW_UP_SOURCE_LABELS: Record<C.FollowUpSource, string> = {
  manual: 'Staff',
  emr: 'Doctor',
  feedback: 'Low rating',
};

export function LeadStatusBadge({ status }: { status: C.LeadStatus }) {
  const variant = status === 'converted' ? 'accent' : status === 'lost' ? 'destructive' : status === 'new' ? 'default' : 'secondary';
  return <Badge variant={variant}>{LEAD_STATUS_LABELS[status]}</Badge>;
}

export function StatementStatusBadge({ status }: { status: C.StatementStatus }) {
  const variant = status === 'paid' ? 'accent' : status === 'cancelled' ? 'destructive' : status === 'approved' ? 'default' : 'secondary';
  return <Badge variant={variant}>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
}

/** Native select styled like Input. */
export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    />
  );
}

/** Small labelled field wrapper. */
export function Field({ id, label, children, className, error }: { id?: string; label: string; children: React.ReactNode; className?: string; error?: string }) {
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

export function StatTile({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: 'warn' }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', tone === 'warn' && 'text-destructive')}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

export function Pager<T>({ data, page, setPage }: { data: Paginated<T> | undefined; page: number; setPage: (p: number) => void }) {
  if (!data || data.total <= data.pageSize) return null;
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

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Search-and-pick a patient (name, UHID or mobile). */
export function PatientPicker({ value, onChange, label = 'Patient' }: { value: Patient | null; onChange: (p: Patient | null) => void; label?: string }) {
  const [term, setTerm] = React.useState('');
  const q = useDebounced(term.trim());
  const { data, isFetching } = useQuery({
    queryKey: ['patients', { q, page: 1, picker: true }],
    queryFn: () => api.patients.list({ q, pageSize: 8 }),
    enabled: !value && q.length >= 2,
  });

  if (value) {
    return (
      <div>
        <Label>{label}</Label>
        <div className="mt-2 flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
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
      <Label htmlFor="crm-patient-search">{label}</Label>
      <div className="relative mt-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input id="crm-patient-search" className="pl-9" placeholder="Name, UHID or mobile…" value={term} onChange={(e) => setTerm(e.target.value)} autoComplete="off" />
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

/** Dropdown of active referrers. */
export function ReferrerSelect({ id, value, onChange, enabled = true, allowNone = true }: { id?: string; value: string; onChange: (id: string) => void; enabled?: boolean; allowNone?: boolean }) {
  const { data } = useQuery({
    queryKey: ['crm', 'referrers', 'active'],
    queryFn: () => api.crm.referrers.list({ active: 'true', pageSize: 200 }),
    enabled,
  });
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowNone && <option value="">— None —</option>}
      {!allowNone && <option value="">Pick a referrer…</option>}
      {data?.items.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
          {r.organization ? ` (${r.organization})` : ''}
        </option>
      ))}
    </Select>
  );
}

/** Dropdown of camps (newest first). */
export function CampSelect({ id, value, onChange, enabled = true }: { id?: string; value: string; onChange: (id: string) => void; enabled?: boolean }) {
  const { data } = useQuery({ queryKey: ['crm', 'camps', 'pick'], queryFn: () => api.crm.camps.list({ pageSize: 100 }), enabled });
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— None —</option>
      {data?.items.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name} ({c.startsOn})
        </option>
      ))}
    </Select>
  );
}

/** First validation problem from a shared Zod schema, as one readable line (null when the body is valid). */
export function firstIssue(schema: z.ZodType, body: unknown, labels: Record<string, string> = {}): string | null {
  const r = schema.safeParse(body);
  if (r.success) return null;
  const issue = r.error.issues[0]!;
  const key = String(issue.path[0] ?? '');
  const label = labels[key] ?? key;
  return label ? `${label}: ${issue.message}` : issue.message;
}

/** Active staff for assigning enquiries and follow-ups (needs crm.lead.manage or crm.followup.manage). */
export function StaffSelect({ id, value, onChange, enabled = true }: { id?: string; value: string; onChange: (id: string) => void; enabled?: boolean }) {
  const { data } = useQuery({ queryKey: ['crm', 'staff'], queryFn: () => api.crm.staff(), enabled, staleTime: 5 * 60_000 });
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Unassigned —</option>
      {data?.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </Select>
  );
}
