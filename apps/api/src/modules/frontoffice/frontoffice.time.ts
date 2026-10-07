/**
 * Hospital-local dates. Release 1 hospitals are in India, so the OPD day runs on IST (UTC+05:30,
 * no daylight saving). When hospitals get a time zone setting, read it here.
 */
const IST_OFFSET_MS = 330 * 60_000;
export const IST_OFFSET = '+05:30';

/** YYYY-MM-DD of `at` in IST. */
export function istDate(at: Date | string = new Date()): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** [start, end) of an IST calendar day as ISO timestamps. */
export function istDayRange(date: string, toDate = date): { from: string; to: string } {
  const from = new Date(`${date}T00:00:00${IST_OFFSET}`);
  const end = new Date(`${toDate}T00:00:00${IST_OFFSET}`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { from: from.toISOString(), to: end.toISOString() };
}

export function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}
