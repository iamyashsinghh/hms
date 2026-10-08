// Shared bits for the radiology screens. Owned by the "radiology" workstream.
import * as React from 'react';
import type { radiology } from '@hms/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type Variant = 'default' | 'secondary' | 'accent' | 'outline' | 'destructive';

export const ORDER_STATUS: Record<radiology.OrderStatus, { label: string; variant: Variant }> = {
  ordered: { label: 'Ordered', variant: 'outline' },
  scheduled: { label: 'Scheduled', variant: 'secondary' },
  in_progress: { label: 'On machine', variant: 'accent' },
  acquired: { label: 'Awaiting report', variant: 'accent' },
  reported: { label: 'Draft report', variant: 'secondary' },
  finalized: { label: 'Report ready', variant: 'default' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
};

export function OrderStatusBadge({ status }: { status: radiology.OrderStatus }) {
  const s = ORDER_STATUS[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function PriorityBadge({ priority }: { priority: radiology.OrderPriority }) {
  if (priority === 'routine') return null;
  return <Badge variant="destructive">{priority === 'stat' ? 'STAT' : 'Urgent'}</Badge>;
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

export function PrintStyles() {
  return (
    <style>{`
      @media print {
        @page { size: A4; margin: 12mm; }
        body * { visibility: hidden !important; }
        #print-area, #print-area * { visibility: visible !important; }
        #print-area { position: absolute; inset: 0 auto auto 0; width: 100%; padding: 0; box-shadow: none; border: 0; }
      }
    `}</style>
  );
}

export const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export const timeOnly = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

/** `<input type="datetime-local">` value → ISO string with the browser's offset. */
export const localToIso = (v: string) => new Date(v).toISOString();

/** A datetime-local value ("YYYY-MM-DDTHH:mm") for now plus `offsetMinutes`, in the browser's time zone. */
export function localInputValue(offsetMinutes = 0, now = new Date()): string {
  const d = new Date(now.getTime() + offsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const rupees = (n: number | null | undefined) => (n == null ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

export function patientLine(p: radiology.OrderPatient) {
  const age = p.ageYears != null ? `${p.ageYears}y` : '';
  const sex = p.gender ? p.gender.charAt(0).toUpperCase() : '';
  return [age && sex ? `${age}/${sex}` : age || sex, p.uhid].filter(Boolean).join(' · ');
}
