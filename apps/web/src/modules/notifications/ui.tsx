// Small shared pieces for the notifications screens.
import type * as React from 'react';
import type { notifications as n } from '@hms/shared';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export const CHANNEL_LABELS: Record<n.Channel | 'all', string> = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email', push: 'Push', all: 'All channels' };

export const REASON_LABELS: Record<string, string> = {
  no_address: 'No mobile/email/device',
  no_template: 'No template for this channel',
  opted_out: 'Opted out',
  channel_disabled: 'Channel switched off',
  insufficient_credits: 'Not enough credits',
  provider_error: 'Provider error',
};

const STATUS_VARIANT: Record<n.MessageStatus, BadgeProps['variant']> = {
  queued: 'secondary',
  sent: 'default',
  delivered: 'accent',
  failed: 'destructive',
  skipped: 'outline',
};

export function StatusBadge({ status }: { status: n.MessageStatus }) {
  return <Badge variant={STATUS_VARIANT[status]} className="capitalize">{status}</Badge>;
}

export function ChannelBadge({ channel }: { channel: n.Channel | 'all' }) {
  return <Badge variant="outline">{CHANNEL_LABELS[channel]}</Badge>;
}

export const rupees = (v: number) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const formatDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : '—';

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}

export function Checkbox({ label, className, ...props }: React.ComponentProps<'input'> & { label: React.ReactNode }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-sm', className)}>
      <input type="checkbox" className="size-4 rounded border-input accent-[var(--color-primary)]" {...props} />
      {label}
    </label>
  );
}

export function ErrorBox({ children }: { children: React.ReactNode }) {
  return <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{children}</div>;
}
