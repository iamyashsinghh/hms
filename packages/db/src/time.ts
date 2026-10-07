/** Postgres timestamptz string (Drizzle string mode) -> ISO 8601 for API responses. */
export function iso(value: string): string;
export function iso(value: string | null): string | null;
export function iso(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
