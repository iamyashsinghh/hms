'use client';

// Insurance UI helpers shared by the screens in src/app/(app)/insurance.
import * as React from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type { insurance as I } from '@hms/shared';
import { formatDate } from '@/lib/format';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export { ErrorBox, Field, PatientPicker, formatDateTime, formatINR, todayIST, useDebounced } from '@/modules/billing/ui';

export const PAYER_TYPE_LABELS: Record<I.PayerType, string> = {
  insurer: 'Insurer',
  tpa: 'TPA',
  corporate: 'Corporate',
  government: 'Govt. scheme',
};

export const SCHEME_LABELS: Record<I.Scheme, string> = {
  pmjay: 'PM-JAY (Ayushman Bharat)',
  cghs: 'CGHS',
  echs: 'ECHS',
  esic: 'ESIC',
  state: 'State scheme',
  other: 'Other scheme',
};

export const RELATION_LABELS: Record<I.Relation, string> = {
  self: 'Self',
  spouse: 'Spouse',
  child: 'Child',
  parent: 'Parent',
  sibling: 'Sibling',
  other: 'Other',
};

export const DOC_LABELS: Record<I.DocumentType, string> = {
  preauth_form: 'Pre-auth',
  policy_card: 'Policy card',
  id_proof: 'ID proof',
  consultation_notes: 'Consultation notes',
  investigation_reports: 'Investigations',
  discharge_summary: 'Discharge summary',
  final_bill: 'Final bill',
  pharmacy_bills: 'Pharmacy bills',
  claim_form: 'Claim form',
  other: 'Other',
};

export const DEDUCTION_LABELS: Record<I.DeductionCategory, string> = {
  non_payable: 'Non-payable items',
  tariff_difference: 'Tariff difference',
  copay: 'Co-pay',
  policy_limit: 'Policy limit / sub-limit',
  room_rent: 'Room rent capping',
  other: 'Other',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  query: 'Query',
  approved: 'Approved',
  partially_settled: 'Part settled',
  settled: 'Settled',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};
const STATUS_VARIANTS: Record<string, BadgeProps['variant']> = {
  draft: 'outline',
  submitted: 'secondary',
  query: 'accent',
  approved: 'default',
  partially_settled: 'accent',
  settled: 'default',
  rejected: 'destructive',
  cancelled: 'outline',
};

export const statusLabel = (s: string) => STATUS_LABELS[s] ?? s;

export function StatusBadge({ status }: { status: I.ClaimStatus | I.PreauthStatus }) {
  return <Badge variant={STATUS_VARIANTS[status] ?? 'outline'}>{STATUS_LABELS[status] ?? status}</Badge>;
}

const ACTION_LABELS: Record<string, string> = {
  created: 'Created',
  submitted: 'Submitted to payer',
  query_raised: 'Payer raised a query',
  query_answered: 'Query answered',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  enhancement_requested: 'Enhancement requested',
  settlement_recorded: 'Settlement recorded',
};

/** Status history of a pre-auth or claim. */
export function History({ events }: { events: I.CaseEvent[] }) {
  if (!events.length) return <p className="text-sm text-muted-foreground">No history yet.</p>;
  return (
    <ol className="space-y-3 text-sm">
      {events.map((e) => (
        <li key={e.id} className="border-l-2 pl-3">
          <div className="font-medium">
            {ACTION_LABELS[e.action] ?? e.action}
            {e.amount != null && <span className="font-normal text-muted-foreground"> · ₹{e.amount.toLocaleString('en-IN')}</span>}
          </div>
          {e.note && <div className="text-muted-foreground">{e.note}</div>}
          <div className="text-xs text-muted-foreground">
            {new Date(e.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            {e.byName && ` · ${e.byName}`}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Previous / next footer for paginated tables. */
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  if (!total) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft /> Prev
        </Button>
        <span>
          Page {page} of {pages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

/**
 * A button that opens a one-line form under it (reason, amount…) and runs `onSubmit`.
 * Keeps status actions on detail pages short without a dialog library.
 */
export function ActionForm({
  label,
  variant = 'outline',
  fields,
  submitLabel,
  onSubmit,
  pending,
}: {
  label: string;
  variant?: 'default' | 'outline' | 'destructive' | 'secondary';
  fields: { name: string; label: string; type?: 'text' | 'number' | 'date'; required?: boolean; defaultValue?: string }[];
  submitLabel?: string;
  onSubmit: (values: Record<string, string>) => void;
  pending?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [values, setValues] = React.useState<Record<string, string>>({});
  if (!open) {
    return (
      <Button
        variant={variant}
        onClick={() => {
          setValues(Object.fromEntries(fields.map((f) => [f.name, f.defaultValue ?? ''])));
          setOpen(true);
        }}
      >
        {label}
      </Button>
    );
  }
  return (
    <form
      className="flex w-full flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
        setOpen(false);
      }}
    >
      {fields.map((f) => (
        <label key={f.name} className="flex min-w-40 flex-1 flex-col gap-1 text-xs font-medium">
          {f.label}
          <Input
            type={f.type ?? 'text'}
            step={f.type === 'number' ? '0.01' : undefined}
            required={f.required}
            value={values[f.name] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
          />
        </label>
      ))}
      <Button type="submit" variant={variant === 'outline' ? 'default' : variant} disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        {submitLabel ?? label}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
        Close
      </Button>
    </form>
  );
}

export const coverText = (p: Pick<I.Policy, 'validFrom' | 'validTo'>) =>
  p.validFrom || p.validTo ? `${formatDate(p.validFrom)} – ${formatDate(p.validTo)}` : 'No dates on file';

/** Empty string → undefined, so optional API fields are left out. */
export const opt = (v: string) => (v.trim() === '' ? undefined : v.trim());
export const optNum = (v: string) => (v.trim() === '' ? undefined : Number(v));
