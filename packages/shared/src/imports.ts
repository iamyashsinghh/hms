import { z } from 'zod';

/**
 * Bulk import from Excel / CSV. Shared by every master that offers "Import from Excel".
 *
 * The browser reads the sheet, maps its header row to column keys (by header text or key, case-insensitive)
 * and posts the rows as plain objects. The API coerces each cell (`coerceImportRow`), validates the row with the
 * module's own create schema and reports per-row errors. `dryRun: true` only validates (the preview); `false`
 * creates the valid rows and reports the rest. Row numbers are the spreadsheet's own (header is row 1).
 */

export const IMPORT_MAX_ROWS = 2000;

export type ImportCellType = 'text' | 'number' | 'integer' | 'boolean' | 'date' | 'enum' | 'list';

export interface ImportColumn {
  /** Field key in the module's create schema. */
  key: string;
  /** Header in the template. */
  header: string;
  type: ImportCellType;
  required?: boolean;
  /** Allowed values for `enum` columns (matched case-insensitively; spaces and dashes count as underscores). */
  options?: readonly (string | number)[];
  /** Example value for the template's second row. */
  example?: string | number;
  /** Short hint shown in the import dialog. */
  help?: string;
}

export const importRequestSchema = z.object({
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .min(1, 'The file has no data rows')
    .max(IMPORT_MAX_ROWS, `Import at most ${IMPORT_MAX_ROWS} rows at a time; split the file`),
  /** Validate only (the preview). */
  dryRun: z.boolean().default(true),
  /** When a row's code already exists, update that record instead of reporting it as a duplicate. */
  updateExisting: z.boolean().default(false),
});
export type ImportRequest = z.input<typeof importRequestSchema>;

export interface ImportCellError {
  /** Column header, or null for a whole-row problem. */
  column: string | null;
  message: string;
}

export type ImportRowStatus = 'create' | 'update' | 'created' | 'updated' | 'error';

export interface ImportRowResult {
  /** Spreadsheet row number. */
  row: number;
  /** The row's code / key, when it has one. */
  key: string | null;
  /** Display name for the row (e.g. drug name). */
  label: string | null;
  status: ImportRowStatus;
  errors: ImportCellError[];
}

export interface ImportResult {
  dryRun: boolean;
  total: number;
  /** Rows that will be (dry run) or were created. */
  created: number;
  updated: number;
  failed: number;
  rows: ImportRowResult[];
}

/** Hidden field the client sets to each row's spreadsheet row number. */
export const IMPORT_ROW_FIELD = '__row';

// ---------- cell coercion ----------

const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** "₹1,250.50" → 1250.5; returns the input untouched when it is not a number so validation can report it. */
export function importNumber(v: unknown): unknown {
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v !== 'string') return v;
  const s = v.trim().replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '').replace(/%$/, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return v.trim();
  return Number(s);
}

const TRUE_WORDS = ['yes', 'y', 'true', '1', 'active', 'on'];
const FALSE_WORDS = ['no', 'n', 'false', '0', 'inactive', 'off'];
export function importBoolean(v: unknown): unknown {
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (TRUE_WORDS.includes(s)) return true;
  if (FALSE_WORDS.includes(s)) return false;
  return String(v).trim();
}

const pad = (n: number) => String(n).padStart(2, '0');
function isoDate(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > last) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

/**
 * Dates as people type them in India and as Excel stores them:
 * 2027-03-31, 31/03/2027, 31-03-2027, 31.03.27, an Excel serial number (46477), or month/year for expiry
 * (03/2027, 3-27 → last day of that month). Returns the input untouched when it is not a date.
 */
export function importDate(v: unknown): unknown {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' || (typeof v === 'string' && /^\d{5}(\.\d+)?$/.test(v.trim()))) {
    const serial = Math.floor(Number(v));
    // Excel's day 1 is 1900-01-01 and it counts a 29 Feb 1900 that never was; 25569 is 1970-01-01.
    if (serial > 20000 && serial < 120000) return new Date((serial - 25569) * 86_400_000).toISOString().slice(0, 10);
    return String(v);
  }
  if (typeof v !== 'string') return v;
  const s = v.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return isoDate(+m[1]!, +m[2]!, +m[3]!) ?? s;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) return isoDate(fullYear(+m[3]!), +m[2]!, +m[1]!) ?? s;
  m = /^(\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const y = fullYear(+m[2]!);
    const mo = +m[1]!;
    return mo >= 1 && mo <= 12 ? isoDate(y, mo, new Date(Date.UTC(y, mo, 0)).getUTCDate()) ?? s : s;
  }
  return s;
}

const enumKey = (v: unknown) => String(v).trim().toLowerCase().replace(/[\s-]+/g, '_');
export function importEnum(v: unknown, options: readonly (string | number)[]): unknown {
  if (typeof v === 'number' && options.includes(v)) return v;
  const key = enumKey(v);
  const hit = options.find((o) => enumKey(o) === key);
  if (hit !== undefined) return hit;
  // A number slab typed as text ("18%", "5.0").
  const n = importNumber(v);
  if (typeof n === 'number' && options.includes(n)) return n;
  return String(v).trim();
}

/** "Positive | Negative" or "a, b; c" → ["Positive", "Negative"]. */
export function importList(v: unknown): unknown {
  if (Array.isArray(v)) return v;
  return String(v)
    .split(/[|;,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Convert raw cells to the types the module schema expects. Blank cells are dropped so schema defaults apply. */
export function coerceImportRow(raw: Record<string, unknown>, columns: readonly ImportColumn[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    const v = raw[col.key];
    if (blank(v)) continue;
    switch (col.type) {
      case 'text':
        out[col.key] = typeof v === 'string' ? v.trim() : String(v);
        break;
      case 'number':
      case 'integer':
        out[col.key] = importNumber(v);
        break;
      case 'boolean':
        out[col.key] = importBoolean(v);
        break;
      case 'date':
        out[col.key] = importDate(v);
        break;
      case 'enum':
        out[col.key] = importEnum(v, col.options ?? []);
        break;
      case 'list':
        out[col.key] = importList(v);
        break;
    }
  }
  return out;
}

/** Friendlier message for a failed cell than Zod's default, based on the column's type. */
export function importCellMessage(col: ImportColumn | undefined, zodMessage: string, received: unknown): string {
  if (!col) return zodMessage;
  if (received === undefined) return col.required ? 'Required' : zodMessage;
  switch (col.type) {
    case 'number':
    case 'integer':
      if (typeof received !== 'number') return `Enter a number (got "${String(received)}")`;
      if (col.type === 'integer' && !Number.isInteger(received)) return 'Enter a whole number';
      return zodMessage;
    case 'boolean':
      if (typeof received !== 'boolean') return `Use Yes or No (got "${String(received)}")`;
      return zodMessage;
    case 'date':
      if (typeof received === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(received)) return `Enter a valid date as DD/MM/YYYY (got "${received}")`;
      return zodMessage;
    case 'enum':
      if (col.options && !col.options.includes(received as string)) return `Use one of: ${col.options.join(', ')} (got "${String(received)}")`;
      return zodMessage;
    default:
      return zodMessage;
  }
}

/** Match a sheet header to a column: by header text or key, ignoring case, spaces, `*` and brackets. */
export function matchImportColumn(header: string, columns: readonly ImportColumn[]): ImportColumn | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)|\*/g, '').replace(/[^a-z0-9]/g, '');
  const h = norm(header);
  if (!h) return undefined;
  return columns.find((c) => norm(c.header) === h || norm(c.key) === h);
}
