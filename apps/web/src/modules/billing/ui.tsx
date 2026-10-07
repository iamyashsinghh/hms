'use client';

// Billing UI helpers shared by the screens in src/app/(app)/billing.
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import type { billing as B, Patient } from '@hms/shared';
import { api } from '@/lib/api';
import { fullName } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
export const formatINR = (v: number | null | undefined) => (v == null ? '—' : inr.format(v));

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  return n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
}

/** Indian numbering: crore, lakh, thousand, hundred. */
export function amountInWords(amount: number): string {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  const parts: string[] = [];
  let n = rupees;
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = Math.floor(n / 100);
  n %= 100;
  if (crore) parts.push(`${crore > 99 ? amountInWords(crore).replace(/ Rupees.*$/, '') : twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (n) parts.push(twoDigits(n));
  const words = parts.length ? parts.join(' ') : 'Zero';
  return `${words} Rupees${paise ? ` and ${twoDigits(paise)} Paise` : ''} Only`;
}

export const formatDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export const MODE_LABELS: Record<B.SettlementMode, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank: 'Bank transfer',
  cheque: 'Cheque',
  deposit: 'From advance',
};

export const CATEGORY_LABELS: Record<B.ServiceCategory, string> = {
  consultation: 'Consultation',
  procedure: 'Procedure',
  lab: 'Lab',
  radiology: 'Radiology',
  room: 'Room / bed',
  nursing: 'Nursing',
  pharmacy: 'Pharmacy',
  package: 'Package',
  other: 'Other',
};

export function InvoiceStatusBadge({ inv }: { inv: Pick<B.InvoiceSummary, 'status' | 'paymentStatus'> }) {
  if (inv.status === 'draft') return <Badge variant="secondary">Draft</Badge>;
  if (inv.status === 'cancelled') return <Badge variant="destructive">Cancelled</Badge>;
  if (inv.paymentStatus === 'paid') return <Badge variant="accent">Paid</Badge>;
  if (inv.paymentStatus === 'partial') return <Badge variant="default">Part paid</Badge>;
  return <Badge variant="outline">Unpaid</Badge>;
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
            <span className="font-medium">{fullName(value)}</span>{' '}
            <span className="font-mono text-xs text-muted-foreground">{value.uhid}</span>
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
      <Label htmlFor="patient-search">{label}</Label>
      <div className="relative mt-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input id="patient-search" className="pl-9" placeholder="Name, UHID or mobile…" value={term} onChange={(e) => setTerm(e.target.value)} autoComplete="off" />
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
