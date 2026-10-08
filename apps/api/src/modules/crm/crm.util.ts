import { eq, users, type Tx } from '@hms/db';
import { badRequest } from '../../common/errors/errors';
import { currentContext } from '../../common/context/request-context';

/** numeric(14,2) string from Postgres -> number of rupees. */
export const toNumber = (v: string | number | null | undefined): number => (v == null ? 0 : Number(v));
export const toNumberOrNull = (v: string | null | undefined): number | null => (v == null ? null : Number(v));
/** Rupees -> integer paise, to add money without float drift. */
export const paise = (v: string | number): number => Math.round(Number(v) * 100);
export const rupees = (p: number): number => p / 100;
export const moneyString = (v: number): string => (Math.round(v * 100) / 100).toFixed(2);

/** Today's date in India (YYYY-MM-DD). */
export const todayIST = (at: Date = new Date()): string => at.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** First day of the month containing `day`. */
export const monthStart = (day: string): string => `${day.slice(0, 7)}-01`;

export function actor(): string | null {
  return currentContext()?.userId ?? null;
}

export function tenantId(): string {
  const id = currentContext()?.tenantId;
  if (!id) throw new Error('crm: no hospital in the request context');
  return id;
}

export const personName = (first: string, last: string | null) => (last ? `${first} ${last}` : first);

/** An assignee must be an active staff user of this hospital (RLS scopes the lookup to the tenant). */
export async function checkAssignee(tx: Tx, userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  const [u] = await tx.select({ status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u || u.status !== 'active') throw badRequest('invalid_assignee', 'Pick an active staff member to assign');
}
