/** Rows -> CSV (RFC 4180) with a BOM so Excel opens UTF-8 correctly. Cells that look like formulas are quoted with a leading apostrophe. */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const lines = [cols.map(cell).join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
