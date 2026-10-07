import { sql } from 'drizzle-orm';
import type { Tx } from './client';

/**
 * Next value of a number series (UHID, invoice no...). Locks the counter row until the
 * transaction ends, so numbers never repeat. Call inside withTenant().
 */
export async function nextCounter(tx: Tx, key: string): Promise<number> {
  const res = await tx.execute<{ value: string }>(sql`
    insert into setup.counters (tenant_id, key, next_value)
    values (app.current_tenant_id(), ${key}, 2)
    on conflict (tenant_id, key) do update
      set next_value = setup.counters.next_value + 1, updated_at = now()
    returning next_value - 1 as value`);
  const row = res.rows[0];
  if (!row) throw new Error(`Counter ${key} returned no row`);
  return Number(row.value);
}

/** Formats a counter as PREFIX + zero-padded number, e.g. formatSeries('UH', 42, 6) = 'UH000042'. */
export function formatSeries(prefix: string, value: number, width = 6): string {
  return `${prefix}${String(value).padStart(width, '0')}`;
}
