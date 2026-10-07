import { iso } from '@hms/db';
import type { quality as Q } from '@hms/shared';
import { badRequest, conflict } from '../../common/errors/errors';
import type { CapaRow } from './quality.repository';

const IST_MS = 330 * 60_000;

/** Calendar date in India for an instant (defaults to now). */
export function istDate(at: Date | string = new Date()): string {
  return new Date(new Date(at).getTime() + IST_MS).toISOString().slice(0, 10);
}

export const currentPeriod = () => istDate().slice(0, 7);

/** First day of the month and first day of the next month, as YYYY-MM-DD. */
export function periodRange(period: string): { start: string; end: string } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { start: `${period}-01`, end: `${next}-01` };
}

/** The `months` periods ending with `to`, oldest first. */
export function periodsBack(to: string, months: number): string[] {
  const [y, m] = to.split('-').map(Number) as [number, number];
  const out: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

export function assertTransition<S extends string>(what: string, map: Record<S, readonly S[]>, from: S, to: S): void {
  if (from === to) return;
  if (!map[from].includes(to)) throw conflict('invalid_transition', `${what} cannot move from ${from.replace('_', ' ')} to ${to.replace('_', ' ')}`);
}

export const requireNote = (note: string | undefined, message: string) => {
  if (!note?.trim()) throw badRequest('note_required', message);
};

export function capaOverdue(r: Pick<CapaRow, 'status' | 'dueDate'>): boolean {
  return (r.status === 'open' || r.status === 'in_progress') && r.dueDate < istDate();
}

export function capaSummary(r: CapaRow, people: Map<string, Q.Person>): Q.CapaSummary {
  return {
    id: r.id,
    capaNo: r.capaNo,
    sourceType: r.sourceType as Q.CapaSource,
    sourceId: r.sourceId,
    title: r.title,
    owner: r.ownerId ? (people.get(r.ownerId) ?? null) : null,
    dueDate: r.dueDate,
    status: r.status as Q.CapaStatus,
    overdue: capaOverdue(r),
  };
}

export const isoOrNull = (v: string | null) => (v ? iso(v) : null);
