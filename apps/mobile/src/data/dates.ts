/** Local calendar date as YYYY-MM-DD (the hospital's day, not UTC). */
export function isoDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return isoDate(new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
}

export function dayLabel(date: string, today = isoDate()): string {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  if (date === addDays(today, 1)) return 'Tomorrow';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function timeLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export function dateTimeLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** ₹ with Indian digit grouping, no paise for whole rupees. */
export function rupees(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
