'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { setup } from '@hms/shared';
import { ZodError } from 'zod';
import { errorMessage } from '@/lib/api';
import { FieldError } from '@/components/field-error';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export const S = setup;

/** HTML inputs give '' for empty fields; the schemas want them absent. */
export const opt = { setValueAs: (v: string) => (v === '' ? undefined : v) };
export const optNumber = { setValueAs: (v: string) => (v === '' || v === undefined ? undefined : Number(v)) };
export const optNull = { setValueAs: (v: string) => (v === '' ? null : v) };

export function Field({
  id,
  label,
  error,
  hint,
  children,
  className,
}: {
  id: string;
  label: string;
  error?: { message?: string };
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-2">{children}</div>
      {hint && !error?.message && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-1">
        <FieldError error={error} />
      </div>
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {error instanceof ZodError ? (error.issues[0]?.message ?? 'Some fields are invalid') : errorMessage(error)}
    </div>
  );
}

export function SuccessBox({ children }: { children: React.ReactNode }) {
  return <div role="status" className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{children}</div>;
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
      <ArrowLeft /> {label}
    </Link>
  );
}

export const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);

export const timeIST = (iso: string, tz = 'Asia/Kolkata') =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: tz });

/** Shows a generated password once with a copy button. */
export function TemporaryPassword({ name, password, delivery }: { name: string; password: string; delivery?: setup.CredentialDelivery[] }) {
  const sent = delivery?.filter((d) => d.status !== 'skipped' && d.status !== 'failed') ?? [];
  const notSent = delivery?.filter((d) => d.status === 'skipped' || d.status === 'failed') ?? [];
  const [copied, setCopied] = React.useState(false);
  return (
    <SuccessBox>
      <p>
        Temporary password for <strong>{name}</strong>: <code className="rounded bg-white px-1.5 py-0.5 font-mono text-base">{password}</code>{' '}
        <button
          type="button"
          className="ml-1 underline"
          onClick={() => navigator.clipboard?.writeText(password).then(() => setCopied(true))}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </p>
      <p className="mt-1 text-xs">
        {sent.length
          ? `Login details sent by ${sent.map((d) => (d.channel === 'sms' ? 'SMS' : d.channel)).join(' and ')}. `
          : 'Not sent automatically. '}
        It is shown only once{sent.length ? '' : '; share it with the user privately'}.
        {notSent.length > 0 && ` (${notSent.map((d) => `${d.channel}: ${(d.reason ?? d.status).replace(/_/g, ' ')}`).join(', ')})`}
      </p>
    </SuccessBox>
  );
}

export function StatusBadge({ status }: { status: setup.UserStatus }) {
  if (status === 'active') return <Badge>Active</Badge>;
  if (status === 'disabled') return <Badge variant="destructive">Disabled</Badge>;
  return <Badge variant="secondary">Invited</Badge>;
}
