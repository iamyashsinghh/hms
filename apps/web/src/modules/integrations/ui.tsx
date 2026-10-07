'use client';

// Integrations UI helpers shared by the screens in src/app/(app)/integrations.
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Copy, Search, X } from 'lucide-react';
import type { Patient, integrations as I } from '@hms/shared';
import { api } from '@/lib/api';
import { fullName } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TableCell, TableRow } from '@/components/ui/table';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
export const formatINR = (v: number | null | undefined) => (v == null ? '—' : inr.format(v));

export const formatDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/** yyyy-mm-dd for a date N days from today (negative for the past). */
export const isoDateOffset = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
};

/** 14-digit ABHA number as 12-3456-7890-1234. */
export const formatAbhaNumber = (n: string | null | undefined) => {
  if (!n) return '—';
  const d = n.replace(/\D/g, '');
  return d.length === 14 ? `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}-${d.slice(10)}` : n;
};

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Small labelled field wrapper. */
export function Field({ id, label, hint, error, children, className }: { id?: string; label: string; hint?: React.ReactNode; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-2">{children}</div>
      {hint && !error && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
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

export function Notice({ tone = 'info', children, className = '' }: { tone?: 'info' | 'warn' | 'success'; children: React.ReactNode; className?: string }) {
  const cls =
    tone === 'warn'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200'
      : tone === 'success'
        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'
        : 'border-primary/30 bg-primary/5 text-foreground';
  return <div className={`rounded-md border px-3 py-2 text-sm ${cls} ${className}`}>{children}</div>;
}

type Tone = 'good' | 'warn' | 'bad' | 'neutral' | 'info';
const TONES: Record<string, Tone> = {
  linked: 'good',
  verified: 'good',
  granted: 'good',
  paid: 'good',
  delivered: 'good',
  accepted: 'good',
  recorded: 'good',
  registered: 'good',
  active: 'good',
  pending: 'warn',
  requested: 'warn',
  created: 'info',
  otp_sent: 'info',
  failed: 'bad',
  rejected: 'bad',
  denied: 'bad',
  error: 'bad',
  revoked: 'bad',
  unlinked: 'neutral',
  expired: 'neutral',
  cancelled: 'neutral',
  dismissed: 'neutral',
};

export const humanize = (s: string) => {
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = TONES[status] ?? 'neutral';
  const variant = tone === 'good' ? 'accent' : tone === 'bad' ? 'destructive' : tone === 'info' ? 'default' : tone === 'warn' ? 'outline' : 'secondary';
  return (
    <Badge variant={variant} className={tone === 'warn' ? 'border-amber-500/50 text-amber-700 dark:text-amber-300' : undefined}>
      {label ?? humanize(status)}
    </Badge>
  );
}

/** One table row spanning all columns, for loading / empty / error states. */
export function MessageRow({ colSpan, children, error }: { colSpan: number; children: React.ReactNode; error?: boolean }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className={`py-10 text-center ${error ? 'text-destructive' : 'text-muted-foreground'}`}>
        {children}
      </TableCell>
    </TableRow>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
      <span>
        Page {page} of {pages} · {total} total
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

/** Read-only box with a copy button (for API keys, secrets, URLs). */
export function CopyBox({ value, className = '' }: { value: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className={`flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 ${className}`}>
      <code className="min-w-0 flex-1 break-all font-mono text-xs">{value}</code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        aria-label="Copy"
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

/** Patient name + UHID for a patient id (cached; falls back to a short id). */
export function PatientName({ id }: { id: string | null | undefined }) {
  const { data } = useQuery({
    queryKey: ['patients', 'detail', id],
    queryFn: () => api.patients.get(id!),
    enabled: !!id,
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (!id) return <span className="text-muted-foreground">—</span>;
  if (!data) return <span className="font-mono text-xs text-muted-foreground">{id.slice(0, 8)}</span>;
  return (
    <span>
      <span className="font-medium">{fullName(data)}</span> <span className="font-mono text-xs text-muted-foreground">{data.uhid}</span>
    </span>
  );
}

/** Search-and-pick a patient (name, UHID or mobile). */
export function PatientPicker({ value, onChange, label = 'Patient', id = 'patient-search' }: { value: Patient | null; onChange: (p: Patient | null) => void; label?: string; id?: string }) {
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

/** Checkbox list for picking several values from a fixed set. */
export function CheckboxGroup<T extends string>({
  options,
  value,
  onChange,
  labels,
  className = 'grid gap-2 sm:grid-cols-2',
  disabled,
}: {
  options: readonly T[];
  value: T[];
  onChange: (v: T[]) => void;
  labels?: Partial<Record<T, string>>;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div className={className}>
      {options.map((o) => (
        <label key={o} className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            disabled={disabled}
            checked={value.includes(o)}
            onChange={(e) => onChange(e.target.checked ? [...value, o] : value.filter((x) => x !== o))}
          />
          <span>
            {labels?.[o] ?? o}
            {labels?.[o] && <span className="block font-mono text-xs text-muted-foreground">{o}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

/** Collapsible JSON viewer. */
export function JsonDetails({ value, summary = 'Show JSON' }: { value: unknown; summary?: string }) {
  return (
    <details className="rounded-md border bg-muted/30">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">{summary}</summary>
      <pre className="max-h-96 overflow-auto border-t p-3 font-mono text-xs">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

/** Simple modal dialog. */
export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} rounded-xl border bg-card text-card-foreground shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/** Current ABDM mode (undefined while loading or when settings are not readable). */
export function useAbdmMode(): I.AbdmMode | undefined {
  return useIntegrationSettings()?.abdmMode;
}

export function useIntegrationSettings(): I.IntegrationSettings | undefined {
  const { data } = useQuery({ queryKey: ['integrations', 'settings'], queryFn: () => api.integrations.settings.get(), retry: false, staleTime: 60_000 });
  return data;
}
