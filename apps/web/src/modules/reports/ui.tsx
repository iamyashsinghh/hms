'use client';

import * as React from 'react';
import { Download, Loader2, TrendingDown, TrendingUp } from 'lucide-react';
import type { reports } from '@hms/shared';
import { errorMessage } from '@/lib/api';
import { useAuth, usePermission } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { downloadCsv } from './download';

// ---------- formatting ----------

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inrExact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
const count = new Intl.NumberFormat('en-IN');

export const money = (n: number) => inr.format(n);
export const moneyExact = (n: number) => inrExact.format(n);
export const num = (n: number) => count.format(n);
/** "1 payment", "3 payments" */
export const plural = (n: number, word: string) => `${count.format(n)} ${word}${n === 1 ? '' : 's'}`;
export const modeLabel = (m: string) => (m.length <= 4 ? m.toUpperCase() : m.charAt(0).toUpperCase() + m.slice(1));

export function shortDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

/** Today in the browser's local time as YYYY-MM-DD (the API uses the hospital's time zone). */
export function localToday(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------- filters ----------

export interface RangeValue {
  from: string;
  to: string;
  facilityId?: string;
}

export function useRange(days = 7): [RangeValue, (v: RangeValue) => void] {
  const [today] = React.useState(localToday);
  return React.useState<RangeValue>({ from: addDays(today, -(days - 1)), to: today });
}

const PRESETS = [
  { label: 'Today', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
];

function FacilitySelect({ value, onChange }: { value?: string; onChange: (id?: string) => void }) {
  const { user } = useAuth();
  if (!user || user.facilities.length < 2) return null;
  return (
    <div className="space-y-1.5">
      <Label htmlFor="facility">Facility</Label>
      <Select id="facility" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} className="w-48">
        <option value="">All facilities</option>
        {user.facilities.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** One row of filters above the report: date range (or single date), facility, CSV export. */
export function RangeFilters({
  value,
  onChange,
  exports = [],
  extra,
  busy,
}: {
  value: RangeValue;
  onChange: (v: RangeValue) => void;
  exports?: { report: reports.ExportReport; label: string }[];
  extra?: React.ReactNode;
  busy?: boolean;
}) {
  const today = localToday();
  return (
    <div className="mb-6 flex flex-wrap items-end gap-3">
      <div className="flex gap-1 rounded-lg border bg-card p-1">
        {PRESETS.map((p) => {
          const from = addDays(today, -(p.days - 1));
          const active = value.from === from && value.to === today;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange({ ...value, from, to: today })}
              className={cn('rounded-md px-3 py-1.5 text-xs font-medium', active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="from">From</Label>
        <Input id="from" type="date" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} className="w-40" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="to">To</Label>
        <Input id="to" type="date" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} className="w-40" />
      </div>
      <FacilitySelect value={value.facilityId} onChange={(facilityId) => onChange({ ...value, facilityId })} />
      {extra}
      {busy && <Loader2 className="mb-2.5 size-4 animate-spin text-muted-foreground" />}
      <div className="ml-auto flex flex-wrap gap-2">
        {exports.map((e) => (
          <ExportButton key={e.report} label={e.label} query={{ report: e.report, from: value.from, to: value.to, facilityId: value.facilityId }} />
        ))}
      </div>
    </div>
  );
}

export function DateFilter({
  date,
  facilityId,
  onChange,
  busy,
  actions,
}: {
  date: string;
  facilityId?: string;
  onChange: (v: { date: string; facilityId?: string }) => void;
  busy?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="date">Date</Label>
        <Input id="date" type="date" value={date} max={localToday()} onChange={(e) => e.target.value && onChange({ date: e.target.value, facilityId })} className="w-40" />
      </div>
      <FacilitySelect value={facilityId} onChange={(id) => onChange({ date, facilityId: id })} />
      {busy && <Loader2 className="mb-2.5 size-4 animate-spin text-muted-foreground" />}
      <div className="ml-auto flex gap-2">{actions}</div>
    </div>
  );
}

export function ExportButton({ label = 'Export CSV', query }: { label?: string; query: reports.ExportQuery }) {
  const allowed = usePermission('reports.export.create');
  const [state, setState] = React.useState<{ busy: boolean; error?: string }>({ busy: false });
  if (!allowed) return null;
  return (
    <div className="flex flex-col items-end">
      <Button
        variant="outline"
        size="sm"
        disabled={state.busy}
        onClick={async () => {
          setState({ busy: true });
          try {
            await downloadCsv(query);
            setState({ busy: false });
          } catch (e) {
            setState({ busy: false, error: errorMessage(e) });
          }
        }}
      >
        {state.busy ? <Loader2 className="animate-spin" /> : <Download />} {label}
      </Button>
      {state.error && <span className="mt-1 text-xs text-destructive">{state.error}</span>}
    </div>
  );
}

// ---------- tiles and charts ----------

export function StatTile({
  label,
  value,
  previous,
  hint,
  format = num,
}: {
  label: string;
  value: number;
  previous?: number;
  hint?: string;
  format?: (n: number) => string;
}) {
  const delta = previous === undefined ? null : value - previous;
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold tabular-nums">{format(value)}</p>
        {delta !== null ? (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            {delta > 0 ? <TrendingUp className="size-3.5" /> : delta < 0 ? <TrendingDown className="size-3.5" /> : null}
            {delta === 0 ? 'Same as' : `${delta > 0 ? '+' : '−'}${format(Math.abs(delta))} vs`} previous day
          </p>
        ) : (
          hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Single-series vertical bar chart (one measure per chart, no second axis). Each bar has a hover
 * tooltip and a larger hit target; the same numbers are available in the table below it.
 */
export function BarChart({
  title,
  data,
  format = num,
  height = 180,
}: {
  title: string;
  data: { label: string; value: number }[];
  format?: (n: number) => string;
  height?: number;
}) {
  const [hover, setHover] = React.useState<number | null>(null);
  const [asTable, setAsTable] = React.useState(false);
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0);
  const labelEvery = Math.max(1, Math.ceil(data.length / 10));

  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between pb-2">
        <div>
          <CardTitle className="text-sm">{title}</CardTitle>
          <p className="mt-1 text-lg font-semibold tabular-nums">{format(total)}</p>
        </div>
        <button type="button" className="text-xs text-primary hover:underline" onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'Show chart' : 'Show table'}
        </button>
      </CardHeader>
      <CardContent>
        {asTable ? (
          <div className="max-h-64 overflow-y-auto">
            <SimpleTable head={['Date', title]} rows={data.map((d) => [d.label, format(d.value)])} align={['left', 'right']} />
          </div>
        ) : (
          <div className="relative" style={{ height }}>
            <div className="absolute inset-x-0 bottom-5 border-t border-border" />
            <div className="absolute inset-0 bottom-5 flex items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
              {data.map((d, i) => (
                <div
                  key={d.label + i}
                  className="group relative flex h-full flex-1 items-end"
                  onMouseEnter={() => setHover(i)}
                  role="img"
                  aria-label={`${d.label}: ${format(d.value)}`}
                >
                  <div
                    className={cn('w-full rounded-t bg-primary transition-opacity', hover !== null && hover !== i && 'opacity-50')}
                    style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value > 0 ? 2 : 0, maxWidth: 48, margin: '0 auto' }}
                  />
                  {hover === i && (
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border bg-card px-2 py-1 text-xs shadow-md">
                      <span className="text-muted-foreground">{d.label}</span> <span className="font-semibold tabular-nums">{format(d.value)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="absolute inset-x-0 bottom-0 flex gap-[2px] text-[10px] text-muted-foreground">
              {data.map((d, i) => (
                <span key={d.label + i} className="flex min-w-0 flex-1 justify-center whitespace-nowrap">
                  {i % labelEvery === 0 ? d.label : ''}
                </span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Ranked horizontal bars (top doctors, services, payment modes): label, bar, value. */
export function RankList({
  title,
  rows,
  format = num,
  empty = 'No data for this period.',
}: {
  title: string;
  rows: { key: string; label: string; value: number; sub?: string }[];
  format?: (n: number) => string;
  empty?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">{empty}</p>}
        {rows.map((r) => (
          <div key={r.key} title={`${r.label}: ${format(r.value)}`}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate">
                {r.label}
                {r.sub && <span className="ml-2 text-xs text-muted-foreground">{r.sub}</span>}
              </span>
              <span className="font-medium tabular-nums">{format(r.value)}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-muted">
              <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function SimpleTable({
  head,
  rows,
  align = [],
  empty = 'Nothing to show.',
}: {
  head: string[];
  rows: React.ReactNode[][];
  align?: ('left' | 'right')[];
  empty?: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {head.map((h, i) => (
            <TableHead key={h} className={align[i] === 'right' ? 'text-right' : undefined}>
              {h}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={head.length} className="py-8 text-center text-muted-foreground">
              {empty}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((r, i) => (
            <TableRow key={i}>
              {r.map((c, j) => (
                <TableCell key={j} className={align[j] === 'right' ? 'text-right tabular-nums' : undefined}>
                  {c}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  return <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{errorMessage(error)}</p>;
}

export function EmptyHint() {
  return (
    <p className="mb-6 rounded-lg border border-dashed bg-card p-4 text-sm text-muted-foreground">
      Visits, bills and payments appear here as the front office, billing and pharmacy modules record them.
    </p>
  );
}
