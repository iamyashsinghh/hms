import { eq, inArray, sql } from '@hms/db';
import { badRequest } from '../../common/errors/errors';
import { currentContext } from '../../common/context/request-context';

type SQL = ReturnType<typeof sql>;
type Column = Parameters<typeof eq>[0];

/** Today's date in India (YYYY-MM-DD). */
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** numeric column (string) -> number, keeping null. */
export const num = (v: string | null): number | null => (v === null ? null : Number(v));

/** Money/number input -> numeric column string. */
export const dec = (v: number | undefined): string | undefined => (v === undefined ? undefined : v.toFixed(2));

export function actorId(): string | null {
  return currentContext()?.userId ?? null;
}

/** The facility the caller is working in; ops records are always per facility (branch). */
export function requireFacility(): string {
  const id = currentContext()?.facilityId;
  if (!id) throw badRequest('facility_required', 'Choose the facility (branch) you are working in');
  return id;
}

/** Facility filter for lists: the selected facility, else every facility the caller may see. */
export function facilityCond(col: Column): SQL | undefined {
  const ctx = currentContext();
  if (ctx?.facilityId) return eq(col, ctx.facilityId);
  if (ctx && ctx.facilityIds !== 'all') return ctx.facilityIds.length ? inArray(col, ctx.facilityIds) : sql`false`;
  return undefined;
}

/** Drop undefined keys so Drizzle .set() only touches provided fields. */
export function defined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
