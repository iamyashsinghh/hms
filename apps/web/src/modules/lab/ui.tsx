'use client';

// Lab UI helpers shared by the screens in src/app/(app)/lab.
import { lab as L } from '@hms/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export const ORDER_STATUS_LABELS: Record<L.OrderStatus, string> = {
  ordered: 'Awaiting sample',
  collected: 'Sample collected',
  in_progress: 'In progress',
  completed: 'Reported',
  cancelled: 'Cancelled',
};

export const SAMPLE_STATUS_LABELS: Record<L.SampleStatus, string> = {
  pending: 'To collect',
  collected: 'Collected',
  received: 'Received in lab',
  rejected: 'Rejected',
};

export const FLAG_LABELS: Record<L.ResultFlag, string> = {
  normal: '',
  low: 'L',
  high: 'H',
  critical_low: 'LL',
  critical_high: 'HH',
  abnormal: '*',
};

export const SOURCE_LABELS: Record<L.OrderSource, string> = { walkin: 'Walk-in', emr: 'OPD consult', b2b: 'B2B' };

export function OrderStatusBadge({ status }: { status: L.OrderStatus }) {
  const variant = status === 'completed' ? 'accent' : status === 'cancelled' ? 'secondary' : status === 'ordered' ? 'outline' : 'default';
  return <Badge variant={variant}>{ORDER_STATUS_LABELS[status]}</Badge>;
}

export function PriorityBadge({ priority }: { priority: L.OrderPriority }) {
  if (priority === 'routine') return null;
  return <Badge variant="destructive">{priority === 'stat' ? 'STAT' : 'Urgent'}</Badge>;
}

export function FlagMark({ flag }: { flag: L.ResultFlag | null }) {
  if (!flag || flag === 'normal') return null;
  const critical = flag === 'critical_low' || flag === 'critical_high';
  return (
    <span
      title={flag.replace('_', ' ')}
      className={cn('ml-1 rounded px-1 text-xs font-bold', critical ? 'bg-destructive text-white' : 'text-destructive')}
    >
      {FLAG_LABELS[flag]}
    </span>
  );
}

const trim = (n: number, d: number) => String(Number(n.toFixed(d)));

/** "13–17", "< 200 desirable", "≤ 40"… as printed on a report. */
export function rangeText(r: Pick<L.Result, 'refLow' | 'refHigh' | 'refText' | 'decimals'>): string {
  if (r.refText) return r.refText;
  const d = Math.max(r.decimals, 0) + 1;
  if (r.refLow !== null && r.refHigh !== null) return `${trim(r.refLow, d)} – ${trim(r.refHigh, d)}`;
  if (r.refHigh !== null) return `≤ ${trim(r.refHigh, d)}`;
  if (r.refLow !== null) return `≥ ${trim(r.refLow, d)}`;
  return '';
}

/** Age like "34y" from a date of birth. */
export function ageFromDob(dob: string | null): string {
  if (!dob) return '';
  const b = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) age--;
  return age < 1 ? `${Math.max(0, Math.floor((now.getTime() - b.getTime()) / (30.44 * 86400_000)))}m` : `${age}y`;
}

export const genderShort = (g: string) => (g === 'male' ? 'M' : g === 'female' ? 'F' : 'O');

/** Group results under section headings, keeping panel blocks together. */
export function groupBySection(results: L.Result[]): { section: L.LabSection; results: L.Result[] }[] {
  const out: { section: L.LabSection; results: L.Result[] }[] = [];
  for (const r of results) {
    const last = out.find((g) => g.section === r.section);
    if (last) last.results.push(r);
    else out.push({ section: r.section, results: [r] });
  }
  return out;
}

export const formatDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
