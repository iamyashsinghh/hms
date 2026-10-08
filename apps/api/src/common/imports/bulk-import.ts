import { HttpException } from '@nestjs/common';
import {
  IMPORT_ROW_FIELD,
  coerceImportRow,
  importCellMessage,
  type ImportCellError,
  type ImportColumn,
  type ImportResult,
  type ImportRowResult,
} from '@hms/shared';
import type { importRequestSchema } from '@hms/shared';
import { ZodError, type ZodType, type z } from 'zod';

type ImportRequest = z.output<typeof importRequestSchema>;

/**
 * What a master needs to offer "Import from Excel". Each row goes through the same create/update path as the
 * single-record form, so business rules, audit and events stay in one place.
 */
export interface ImportSpec<T> {
  columns: readonly ImportColumn[];
  /** Row schema; usually the module's create schema (plus import-only columns). */
  schema: ZodType<T>;
  /** Unique key of a row (normalised the way the module stores it), used to catch duplicates. */
  key: (row: T) => string | null;
  label?: (row: T) => string | null;
  /** Which of these keys already exist, mapped to the record id. */
  existing: (keys: string[]) => Promise<Map<string, string>>;
  /** Extra checks that need the database (e.g. an unknown ward code). Return messages to reject the row. */
  check?: (row: T) => Promise<ImportCellError[]> | ImportCellError[];
  create: (row: T) => Promise<unknown>;
  /**
   * Without it, existing keys are always reported as duplicates. `given` holds only the columns the sheet filled
   * in, so blank cells leave the record's current values alone instead of resetting them to defaults.
   */
  update?: (id: string, given: Partial<T>, row: T) => Promise<unknown>;
  /** Runs before `check` on every valid row, once; e.g. to load lookups. */
  prepare?: (rows: T[]) => Promise<void>;
}

export async function runImport<T>(spec: ImportSpec<T>, req: ImportRequest): Promise<ImportResult> {
  const byKey = new Map(spec.columns.map((c) => [c.key, c]));
  const parsed: { result: ImportRowResult; value?: T; given?: Partial<T> }[] = req.rows.map((raw, i) => {
    const rowNo = Number(raw[IMPORT_ROW_FIELD]) || i + 2;
    const cells = coerceImportRow(raw, spec.columns);
    const res = spec.schema.safeParse(cells);
    if (!res.success) {
      const errors = res.error.issues.map((iss) => {
        const field = typeof iss.path[0] === 'string' ? iss.path[0] : null;
        const col = field ? byKey.get(field) : undefined;
        return { column: col?.header ?? field, message: iss.code === 'custom' ? iss.message : importCellMessage(col, iss.message, field ? cells[field] : undefined) };
      });
      return { result: { row: rowNo, key: keyOf(cells), label: labelOf(cells), status: 'error', errors: dedupe(errors) } };
    }
    const given = Object.fromEntries(Object.entries(res.data as object).filter(([k]) => k in cells)) as Partial<T>;
    return {
      result: { row: rowNo, key: spec.key(res.data), label: spec.label?.(res.data) ?? labelOf(cells), status: 'create', errors: [] },
      value: res.data,
      given,
    };
  });

  // Duplicate keys inside the file: the first one wins, the rest are errors.
  const firstRow = new Map<string, number>();
  for (const p of parsed) {
    const k = p.result.key?.toUpperCase();
    if (!k || p.result.status === 'error') continue;
    const seen = firstRow.get(k);
    if (seen !== undefined) fail(p, { column: null, message: `Duplicate of row ${seen} in this file` });
    else firstRow.set(k, p.result.row);
  }

  const valid = parsed.filter((p) => p.result.status !== 'error');
  const keys = valid.map((p) => p.result.key).filter((k): k is string => !!k);
  const existing = keys.length ? await spec.existing(keys) : new Map<string, string>();
  const existingId = (k: string | null) => (k ? existing.get(k) ?? existing.get(k.toUpperCase()) : undefined);
  for (const p of valid) {
    if (!existingId(p.result.key)) continue;
    if (req.updateExisting && spec.update) p.result.status = 'update';
    else fail(p, { column: null, message: spec.update ? `${p.result.key} already exists (tick "Update existing" to overwrite)` : `${p.result.key} already exists` });
  }

  const ready = parsed.filter((p) => p.result.status !== 'error');
  if (spec.prepare) await spec.prepare(ready.map((p) => p.value!));
  if (spec.check) {
    for (const p of ready) {
      const errs = await spec.check(p.value!);
      if (errs.length) fail(p, ...errs);
    }
  }

  if (!req.dryRun) {
    for (const p of parsed) {
      if (p.result.status === 'error') continue;
      try {
        if (p.result.status === 'update') {
          await spec.update!(existingId(p.result.key)!, p.given!, p.value!);
          p.result.status = 'updated';
        } else {
          await spec.create(p.value!);
          p.result.status = 'created';
        }
      } catch (e) {
        fail(p, { column: null, message: errorText(e) });
      }
    }
  }

  const rows = parsed.map((p) => p.result);
  return {
    dryRun: req.dryRun,
    total: rows.length,
    created: rows.filter((r) => r.status === 'create' || r.status === 'created').length,
    updated: rows.filter((r) => r.status === 'update' || r.status === 'updated').length,
    failed: rows.filter((r) => r.status === 'error').length,
    rows,
  };
}

function fail(p: { result: ImportRowResult }, ...errors: ImportCellError[]) {
  p.result.status = 'error';
  p.result.errors.push(...errors);
}

function dedupe(errors: ImportCellError[]): ImportCellError[] {
  const seen = new Set<string>();
  return errors.filter((e) => {
    const k = `${e.column}|${e.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const keyOf = (cells: Record<string, unknown>) => {
  const v = cells.code ?? cells.employeeCode;
  return v === undefined ? null : String(v).toUpperCase();
};
const labelOf = (cells: Record<string, unknown>) => (cells.name === undefined ? null : String(cells.name));

function errorText(e: unknown): string {
  if (e instanceof HttpException) {
    const body = e.getResponse() as { message?: unknown } | string;
    if (typeof body === 'string') return body;
    if (typeof body.message === 'string') return body.message;
  }
  if (e instanceof ZodError) return e.issues.map((i) => i.message).join('; ');
  return 'Could not save this row';
}
