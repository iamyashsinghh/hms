'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import type { pharmacy } from '@hms/shared';
import { api } from '@/lib/api';
import type { FieldErrors } from '@/lib/validate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ItemPicker } from '@/modules/pharmacy/item-picker';

export { inr } from '@/modules/pharmacy/format';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  ordered: 'Ordered',
  cancelled: 'Cancelled',
  partially_received: 'Part received',
  received: 'Received',
  closed: 'Closed',
  partially_issued: 'Part issued',
  issued: 'Issued',
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'accent' | 'outline' | 'destructive'> = {
  draft: 'outline',
  submitted: 'accent',
  approved: 'default',
  partially_received: 'accent',
  partially_issued: 'accent',
  received: 'secondary',
  issued: 'secondary',
  ordered: 'secondary',
  closed: 'secondary',
  rejected: 'destructive',
  cancelled: 'destructive',
};

export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? 'outline'}>{statusLabel(status)}</Badge>;
}

/** All active stores (pharmacy owns them). */
export function useStores() {
  const { data, isPending } = useQuery({ queryKey: ['pharmacy', 'stores'], queryFn: () => api.pharmacy.stores.list() });
  return { stores: (data ?? []).filter((s) => s.isActive), isPending };
}

export function StoreSelect({
  value,
  onChange,
  stores,
  placeholder = 'Choose a store',
  id,
}: {
  value: string;
  onChange: (id: string) => void;
  stores: pharmacy.Store[];
  placeholder?: string;
  id?: string;
}) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {stores.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name} ({s.type})
        </option>
      ))}
    </Select>
  );
}

export interface QtyLine {
  key: number;
  itemId: string;
  name: string;
  unit: string;
  gstRate: number;
  qty: string;
  rate?: string;
}

let nextKey = 1;
export const newLine = (item: Pick<pharmacy.Item, 'id' | 'name' | 'unit' | 'gstRate'>, qty = '', rate?: string): QtyLine => ({
  key: nextKey++,
  itemId: item.id,
  name: item.name,
  unit: item.unit,
  gstRate: item.gstRate,
  qty,
  rate,
});

/** Item lines with qty (and rate, for purchase orders). */
export function LinesEditor({ lines, setLines, withRate = false }: { lines: QtyLine[]; setLines: React.Dispatch<React.SetStateAction<QtyLine[]>>; withRate?: boolean }) {
  const set = (key: number, patch: Partial<QtyLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-4">
      <ItemPicker
        placeholder="Search item by name or code…"
        // The same item twice is refused by the server; picking it again just keeps the existing line.
        onPick={(item) => setLines((ls) => (ls.some((l) => l.itemId === item.id) ? ls : [...ls, newLine(item, '', withRate ? '' : undefined)]))}
      />
      {lines.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Item</TableHead>
              <TableHead>Qty *</TableHead>
              {withRate && <TableHead>Rate (ex GST) *</TableHead>}
              {withRate && <TableHead>GST %</TableHead>}
              {withRate && <TableHead className="text-right">Amount</TableHead>}
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => (
              <TableRow key={l.key}>
                <TableCell>
                  <div className="font-medium">{l.name}</div>
                  <div className="text-xs text-muted-foreground">per {l.unit}</div>
                </TableCell>
                <TableCell>
                  <Input className="w-24" type="number" min={1} max={1000000} step={1} inputMode="numeric" aria-label={`Qty of ${l.name}`} value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} />
                </TableCell>
                {withRate && (
                  <TableCell>
                    <Input className="w-28" type="number" min={0} max={10000000} step="0.01" aria-label={`Rate of ${l.name}`} value={l.rate ?? ''} onChange={(e) => set(l.key, { rate: e.target.value })} />
                  </TableCell>
                )}
                {withRate && (
                  <TableCell>
                    <Input className="w-20" type="number" min={0} max={40} step="0.01" aria-label={`GST of ${l.name}`} value={l.gstRate} onChange={(e) => set(l.key, { gstRate: Number(e.target.value) })} />
                  </TableCell>
                )}
                {withRate && <TableCell className="text-right tabular-nums">{lineTotal(l).toFixed(2)}</TableCell>}
                <TableCell>
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/** qty x rate + GST, as the server computes it. */
export function lineTotal(l: QtyLine): number {
  const base = Math.round(Number(l.rate || 0) * 100) * Number(l.qty || 0);
  return (base + Math.round((base * l.gstRate) / 100)) / 100;
}

export const linesValid = (lines: QtyLine[], withRate = false) =>
  lines.length > 0 && lines.every((l) => Number(l.qty) > 0 && Number.isInteger(Number(l.qty)) && (!withRate || l.rate !== ''));

/** The first validation error, naming the item when it is about a line ("lines.2.qty"). */
export function formErrorMessage(errors: FieldErrors | null, lines?: { name?: string; itemName?: string }[]): string | null {
  const first = errors && Object.entries(errors)[0];
  if (!first) return null;
  const [path, message] = first;
  const m = /^lines\.(\d+)\./.exec(path);
  const line = m ? lines?.[Number(m[1])] : undefined;
  const name = line?.name ?? line?.itemName;
  return name ? `${name}: ${message}` : message;
}

export function Notice({ children, tone = 'ok' }: { children: React.ReactNode; tone?: 'ok' | 'error' }) {
  return (
    <p
      className={`mb-4 rounded-md border px-3 py-2 text-sm ${tone === 'ok' ? 'border-primary/30 bg-primary/5 text-primary' : 'border-destructive/30 bg-destructive/5 text-destructive'}`}
    >
      {children}
    </p>
  );
}
