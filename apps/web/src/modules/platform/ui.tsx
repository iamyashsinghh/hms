'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Info, Megaphone, X } from 'lucide-react';
import type { platform as P } from '@hms/shared';
import { api } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export const inr = (v: string | number | null | undefined) =>
  v === null || v === undefined
    ? 'Custom'
    : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(v));

export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export const humanize = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  trial: 'secondary',
  active: 'accent',
  paid: 'accent',
  resolved: 'accent',
  grace: 'destructive',
  past_due: 'destructive',
  suspended: 'destructive',
  urgent: 'destructive',
  high: 'destructive',
  issued: 'default',
  open: 'default',
  in_progress: 'secondary',
  waiting_on_customer: 'secondary',
  closed: 'outline',
  cancelled: 'outline',
  expired: 'outline',
  void: 'outline',
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? 'outline'} className={className}>
      {humanize(status)}
    </Badge>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {msg}
    </div>
  );
}

const SEVERITY_STYLE: Record<P.Announcement['severity'], { box: string; icon: React.ComponentType<{ className?: string }> }> = {
  info: { box: 'border-primary/20 bg-secondary/60 text-secondary-foreground', icon: Info },
  warning: { box: 'border-amber-300 bg-amber-50 text-amber-900', icon: Megaphone },
  critical: { box: 'border-destructive/40 bg-destructive/10 text-destructive', icon: AlertTriangle },
};

/**
 * Platform announcements for the signed-in hospital user. Rendered on platform pages; the shell
 * can mount it too (foundation-owned header): <AnnouncementsBanner />.
 */
export function AnnouncementsBanner({ className }: { className?: string }) {
  const can = usePermission('platform.help.read');
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['platform', 'announcements'], queryFn: () => api.platform.announcements(), enabled: can, staleTime: 5 * 60_000 });
  const dismiss = useMutation({
    mutationFn: (id: string) => api.platform.dismissAnnouncement(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'announcements'] }),
  });
  if (!data?.length) return null;
  return (
    <div className={cn('space-y-2', className)}>
      {data.map((a) => {
        const s = SEVERITY_STYLE[a.severity];
        const Icon = s.icon;
        return (
          <div key={a.id} className={cn('flex items-start gap-3 rounded-lg border px-4 py-3 text-sm', s.box)}>
            <Icon className="mt-0.5 size-4 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">{a.title}</p>
              <p className="mt-0.5 whitespace-pre-line opacity-90">{a.body}</p>
            </div>
            <button type="button" aria-label="Dismiss" className="rounded p-1 hover:bg-black/5" onClick={() => dismiss.mutate(a.id)}>
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Usage meter: current vs plan limit (null = unlimited). */
export function Meter({ label, used, max }: { label: string; used: number; max: number | null }) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">
          {used} / {max === null ? 'Unlimited' : max}
        </span>
      </div>
      {max !== null && (
        <div className="mt-1.5 h-2 rounded-full bg-muted">
          <div className={cn('h-2 rounded-full', max !== null && used > max ? 'bg-destructive' : pct >= 80 ? 'bg-amber-500' : 'bg-primary')} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

/** Module keys shown to people. */
export const MODULE_LABELS: Record<string, string> = {
  frontoffice: 'Front office & OPD queue',
  emr: 'OPD / EMR',
  billing: 'Billing',
  pharmacy: 'Pharmacy',
  notifications: 'SMS / WhatsApp',
  reports: 'Reports & MIS',
  portal: 'Patient portal',
  mobile: 'Mobile apps',
  lab: 'Laboratory',
  radiology: 'Radiology',
  ipd: 'IPD, nursing, OT',
  inventory: 'Inventory & procurement',
  insurance: 'Insurance & TPA',
  crm: 'Referral & CRM',
  hr: 'HR & roster',
  quality: 'Quality & NABH',
  ops: 'Facility services',
  integrations: 'ABDM & integrations',
};
