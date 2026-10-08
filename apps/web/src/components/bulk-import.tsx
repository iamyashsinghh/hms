'use client';

import * as React from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import { IMPORT_MAX_ROWS, IMPORT_ROW_FIELD, matchImportColumn, type ImportColumn, type ImportRequest, type ImportResult } from '@hms/shared';
import { errorMessage } from '@/lib/api';
import { downloadBlob, readSpreadsheet, toCsv, writeXlsx, type Cell } from '@/lib/spreadsheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export interface BulkImportProps {
  /** e.g. "drugs" — used in titles and file names. */
  noun: string;
  columns: readonly ImportColumn[];
  /** Posts the rows; `dryRun` validates only. */
  run: (req: ImportRequest) => Promise<ImportResult>;
  /** Offer "update existing" (re-importing a sheet updates records with the same code). */
  allowUpdate?: boolean;
  /** Queries to refresh after an import. */
  invalidate?: QueryKey[];
  /** Extra controls above the file picker (e.g. the store for opening stock). */
  children?: React.ReactNode;
  /** Disables Validate/Import (e.g. until a required option is chosen) with this hint. */
  blockedReason?: string | null;
  /** Changes when the extra controls change, so the preview is checked again. */
  optionsKey?: string;
  buttonLabel?: string;
}

/** "Import from Excel" button + dialog: template download, upload, server-side preview with row errors, then import. */
export function BulkImportButton(props: BulkImportProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload /> {props.buttonLabel ?? 'Import from Excel'}
      </Button>
      {open && <BulkImportDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

type Parsed = { id: number; fileName: string; rows: Record<string, unknown>[]; ignored: string[] };
let parseSeq = 0;

export function BulkImportDialog({ noun, columns, run, allowUpdate = true, invalidate = [], children, blockedReason, optionsKey, onClose }: BulkImportProps & { onClose: () => void }) {
  const queryClient = useQueryClient();
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = React.useState<Parsed | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [updateExisting, setUpdateExisting] = React.useState(false);
  const [done, setDone] = React.useState<ImportResult | null>(null);
  const [busy, setBusy] = React.useState<'reading' | 'importing' | null>(null);
  const [apiError, setApiError] = React.useState<string | null>(null);
  const [onlyErrors, setOnlyErrors] = React.useState(false);

  // The server checks every row (dry run) whenever the file or the options change.
  const check = useQuery({
    queryKey: ['bulk-import-preview', noun, parsed?.id, updateExisting, optionsKey],
    queryFn: () => run({ rows: parsed!.rows, dryRun: true, updateExisting }),
    enabled: !!parsed && !blockedReason && !done,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const preview = parsed && !blockedReason ? (check.data ?? null) : null;

  async function onFile(file: File) {
    setFileError(null);
    setDone(null);
    setParsed(null);
    setBusy('reading');
    try {
      const sheet = await readSpreadsheet(file);
      if (!sheet.headers.length) throw new Error('The file is empty.');
      const mapping = sheet.headers.map((h) => matchImportColumn(h, columns));
      const missing = columns.filter((c) => c.required && !mapping.some((m) => m?.key === c.key));
      if (missing.length) {
        throw new Error(`Missing column${missing.length > 1 ? 's' : ''}: ${missing.map((c) => c.header).join(', ')}. Download the template to see the expected headers.`);
      }
      if (!sheet.rows.length) throw new Error('The file has a header row but no data rows.');
      if (sheet.rows.length > IMPORT_MAX_ROWS) throw new Error(`The file has ${sheet.rows.length} rows; import at most ${IMPORT_MAX_ROWS} at a time.`);
      const rows = sheet.rows.map(({ rowNo, cells }) => {
        const out: Record<string, unknown> = { [IMPORT_ROW_FIELD]: rowNo };
        mapping.forEach((col, i) => {
          if (col && cells[i] !== null && cells[i] !== undefined && out[col.key] === undefined) out[col.key] = cells[i];
        });
        return out;
      });
      const ignored = sheet.headers.filter((h, i) => h && !mapping[i]);
      setParsed({ id: ++parseSeq, fileName: file.name, rows, ignored });
      setBusy(null);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'Could not read this file');
      setBusy(null);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function doImport() {
    if (!parsed) return;
    setBusy('importing');
    setApiError(null);
    try {
      const res = await run({ rows: parsed.rows, dryRun: false, updateExisting });
      setDone(res);
      for (const key of invalidate) void queryClient.invalidateQueries({ queryKey: key });
    } catch (e) {
      setApiError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  function downloadTemplate() {
    const header: Cell[] = columns.map((c) => (c.required ? `${c.header}*` : c.header));
    const example: Cell[] = columns.map((c) => c.example ?? null);
    const guide: Cell[][] = [
      ['Column', 'Required', 'Allowed values / format', 'Notes'],
      ...columns.map((c) => [
        c.header,
        c.required ? 'Yes' : '',
        c.type === 'enum' ? (c.options ?? []).join(', ') : TYPE_HINT[c.type],
        c.help ?? '',
      ]),
      [],
      ['Row 2 of the first sheet is an example: replace or delete it. Columns can be in any order; extra columns are ignored.'],
    ];
    downloadBlob(
      writeXlsx([
        { name: noun, rows: [header, example], header: true, widths: columns.map((c) => Math.max(12, c.header.length + 4)) },
        { name: 'How to fill', rows: guide, header: true, widths: [24, 10, 60, 50] },
      ]),
      `${noun.toLowerCase().replace(/\s+/g, '-')}-import-template.xlsx`,
    );
  }

  function downloadErrors(result: ImportResult) {
    if (!parsed) return;
    const failed = new Map(result.rows.filter((r) => r.status === 'error').map((r) => [r.row, r]));
    const lines: Cell[][] = [
      ['Row', ...columns.map((c) => c.header), 'Errors'],
      ...parsed.rows
        .filter((r) => failed.has(r[IMPORT_ROW_FIELD] as number))
        .map((r) => [
          r[IMPORT_ROW_FIELD] as number,
          ...columns.map((c) => (r[c.key] ?? null) as Cell),
          failed
            .get(r[IMPORT_ROW_FIELD] as number)!
            .errors.map((e) => (e.column ? `${e.column}: ${e.message}` : e.message))
            .join('; '),
        ]),
    ];
    downloadBlob(new Blob([toCsv(lines)], { type: 'text/csv' }), `${noun.toLowerCase().replace(/\s+/g, '-')}-import-errors.csv`);
  }

  const result = done ?? preview;
  const ready = preview ? preview.created + preview.updated : 0;
  const shown = result ? (onlyErrors ? result.rows.filter((r) => r.status === 'error') : result.rows) : [];

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12" onClick={busy === 'importing' ? undefined : onClose}>
      <Card className="w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Import {noun} from Excel</CardTitle>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose} disabled={busy === 'importing'}>
            <X />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {!done && (
            <>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>
                  Download the{' '}
                  <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={downloadTemplate}>
                    Excel template
                  </button>{' '}
                  and fill one row per {noun.replace(/s$/, '')}. Columns marked * are required.
                </li>
                <li>Upload the .xlsx or .csv file. Nothing is saved until you press Import.</li>
                <li>Fix any rows marked in red (in the file, then upload again), or import only the valid rows.</li>
              </ol>
              {children}
              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={fileInput}
                  type="file"
                  accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onFile(f);
                  }}
                />
                <Button onClick={() => fileInput.current?.click()} disabled={!!busy}>
                  {busy === 'reading' ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} {parsed ? 'Choose another file' : 'Choose file'}
                </Button>
                <Button variant="outline" onClick={downloadTemplate}>
                  <Download /> Template
                </Button>
                {allowUpdate && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} disabled={!!busy || check.isFetching} />
                    Update existing records with the same code
                  </label>
                )}
              </div>
              {parsed && (
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{parsed.fileName}</span>: {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'}
                  {parsed.ignored.length > 0 && <> · ignored columns: {parsed.ignored.join(', ')}</>}
                </p>
              )}
            </>
          )}

          {fileError && <Notice tone="error">{fileError}</Notice>}
          {apiError && <Notice tone="error">{apiError}</Notice>}
          {check.error && <Notice tone="error">{errorMessage(check.error)}</Notice>}
          {parsed && blockedReason && !done && <Notice tone="warn">{blockedReason}</Notice>}
          {check.isFetching && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Checking every row…
            </p>
          )}

          {result && (
            <>
              {done ? (
                <Notice tone={done.failed ? 'warn' : 'ok'}>
                  {done.created > 0 && `${done.created} added. `}
                  {done.updated > 0 && `${done.updated} updated. `}
                  {done.failed > 0 ? `${done.failed} row${done.failed === 1 ? '' : 's'} not imported; download them, fix and import again.` : 'All rows imported.'}
                </Notice>
              ) : (
                <Notice tone={result.failed ? 'warn' : 'ok'}>
                  {ready} of {result.total} row{result.total === 1 ? '' : 's'} ready
                  {result.updated > 0 && ` (${result.updated} will update existing records)`}
                  {result.failed > 0 && `; ${result.failed} with errors will be skipped`}.
                </Notice>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
                  Show only rows with errors
                </label>
                {result.failed > 0 && (
                  <Button variant="outline" size="sm" onClick={() => downloadErrors(result)}>
                    <Download /> Rows with errors (.csv)
                  </Button>
                )}
              </div>
              <div className="max-h-[50vh] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-16">Row</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                          No rows to show.
                        </TableCell>
                      </TableRow>
                    ) : (
                      shown.map((r) => (
                        <TableRow key={r.row} className={r.status === 'error' ? 'bg-destructive/5' : undefined}>
                          <TableCell className="font-mono text-xs">{r.row}</TableCell>
                          <TableCell className="font-mono text-xs">{r.key ?? '—'}</TableCell>
                          <TableCell>{r.label ?? '—'}</TableCell>
                          <TableCell>
                            {r.status === 'error' ? (
                              <ul className="space-y-0.5 text-xs text-destructive">
                                {r.errors.map((e, i) => (
                                  <li key={i}>
                                    {e.column && <span className="font-medium">{e.column}: </span>}
                                    {e.message}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <Badge variant={r.status.startsWith('update') ? 'accent' : 'secondary'}>{STATUS_LABEL[r.status]}</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2">
            {done ? (
              <Button onClick={onClose}>Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={onClose} disabled={busy === 'importing'}>
                  Cancel
                </Button>
                <Button onClick={doImport} disabled={!preview || ready === 0 || !!busy || check.isFetching || !!blockedReason}>
                  {busy === 'importing' && <Loader2 className="animate-spin" />}
                  Import {ready > 0 ? `${ready} row${ready === 1 ? '' : 's'}` : ''}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const TYPE_HINT: Record<ImportColumn['type'], string> = {
  text: 'Text',
  number: 'Number',
  integer: 'Whole number',
  boolean: 'Yes / No',
  date: 'Date as DD/MM/YYYY',
  enum: '',
  list: 'Values separated by |',
};

const STATUS_LABEL: Record<string, string> = { create: 'Will add', update: 'Will update', created: 'Added', updated: 'Updated' };

function Notice({ tone, children }: { tone: 'ok' | 'warn' | 'error'; children: React.ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : AlertTriangle;
  const cls =
    tone === 'ok'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : tone === 'warn'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'
        : 'border-destructive/30 bg-destructive/10 text-destructive';
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${cls}`}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
