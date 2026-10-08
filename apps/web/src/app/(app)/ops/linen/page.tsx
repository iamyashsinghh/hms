'use client';

import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Loader2, Plus } from 'lucide-react';
import { ops as O } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorBox, Field, LINEN_KIND_LABELS, MessageRow, Pager, firstIssue, formatDateTime, opt } from '@/modules/ops/ui';

interface ItemForm {
  id?: string;
  name: string;
  parLevel: string;
  isActive: boolean;
}

function ItemFormCard({ initial, onDone }: { initial: ItemForm; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [f, setF] = React.useState(initial);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name.trim(), parLevel: Number(f.parLevel || 0), isActive: f.isActive };
      const problem = firstIssue(O.linenItemInputSchema, body, { name: 'Item name', parLevel: 'Par level' });
      if (problem) throw new Error(problem);
      return f.id ? api.ops.linen.updateItem(f.id, body) : api.ops.linen.createItem(body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] });
      onDone();
    },
  });
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{f.id ? `Edit ${initial.name}` : 'New linen item'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="sm:col-span-4">
            <ErrorBox error={save.error ? errorMessage(save.error) : null} />
          </div>
          <Field id="li-name" label="Item name *" className="sm:col-span-2">
            <Input id="li-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Bedsheet (single)" required />
          </Field>
          <Field id="li-par" label="Par level (min clean stock)">
            <Input id="li-par" type="number" min={0} step={1} value={f.parLevel} onChange={(e) => setF({ ...f, parLevel: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 pt-7 text-sm">
            <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active
          </label>
          <div className="flex justify-end gap-2 sm:col-span-4">
            <Button type="button" variant="outline" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function MovementForm({ items, onDone }: { items: O.LinenItem[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [itemId, setItemId] = React.useState(items[0]?.id ?? '');
  const [kind, setKind] = React.useState<O.LinenTxnKind>('issue');
  const [qty, setQty] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [fromPool, setFromPool] = React.useState<'clean' | 'soiled'>('soiled');
  const [reference, setReference] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const needsLocation = kind === 'issue' || kind === 'collect';
  const record = useMutation({
    mutationFn: () =>
      api.ops.linen.record({
        itemId,
        kind,
        qty: Number(qty),
        location: needsLocation ? opt(location) : undefined,
        fromPool: kind === 'condemn' ? fromPool : undefined,
        reference: opt(reference),
        notes: opt(notes),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] });
      setQty('');
      setReference('');
      setNotes('');
    },
  });
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Record linen movement</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            record.mutate();
          }}
        >
          <div className="sm:col-span-4">
            <ErrorBox error={record.error ? errorMessage(record.error) : null} />
            {record.isSuccess && !record.error && <p className="text-sm text-accent-foreground">Recorded. Stock updated.</p>}
          </div>
          <Field id="mv-kind" label="Movement *">
            <Select id="mv-kind" value={kind} onChange={(e) => setKind(e.target.value as O.LinenTxnKind)}>
              {O.LINEN_TXN_KINDS.map((k) => (
                <option key={k} value={k}>
                  {LINEN_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="mv-item" label="Item *">
            <Select id="mv-item" value={itemId} onChange={(e) => setItemId(e.target.value)} required>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="mv-qty" label="Quantity *">
            <Input id="mv-qty" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} required />
          </Field>
          {needsLocation && (
            <Field id="mv-loc" label="Ward / location *">
              <Input id="mv-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Ward 2" required />
            </Field>
          )}
          {kind === 'condemn' && (
            <Field id="mv-pool" label="Condemn from">
              <Select id="mv-pool" value={fromPool} onChange={(e) => setFromPool(e.target.value as 'clean' | 'soiled')}>
                <option value="soiled">Soiled</option>
                <option value="clean">Clean store</option>
              </Select>
            </Field>
          )}
          <Field id="mv-ref" label="Reference">
            <Input id="mv-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Laundry challan no." />
          </Field>
          <Field id="mv-notes" label="Notes" className="sm:col-span-2">
            <Input id="mv-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="flex items-end justify-end gap-2 sm:col-span-4">
            <Button type="button" variant="outline" onClick={onDone}>
              Close
            </Button>
            <Button type="submit" disabled={record.isPending || !itemId}>
              {record.isPending && <Loader2 className="animate-spin" />}
              Record
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function LinenPage() {
  const canRead = usePermission('ops.linen.read');
  const canManage = usePermission('ops.linen.manage');
  const [panel, setPanel] = React.useState<'move' | ItemForm | null>(null);
  const [kind, setKind] = React.useState('');
  const [page, setPage] = React.useState(1);

  const stock = useQuery({ queryKey: ['ops', 'linen', 'stock'], queryFn: () => api.ops.linen.stock(), enabled: canRead });
  const items = useQuery({ queryKey: ['ops', 'linen', 'items'], queryFn: () => api.ops.linen.items(), enabled: canRead });
  const txQuery: O.LinenTxnQuery = { kind: (kind || undefined) as O.LinenTxnKind | undefined, page, pageSize: 20 };
  const txns = useQuery({ queryKey: ['ops', 'linen', 'txns', txQuery], queryFn: () => api.ops.linen.txns(txQuery), placeholderData: keepPreviousData, enabled: canRead });

  if (!canRead) return <NoAccess />;

  const itemById = new Map((items.data ?? []).map((i) => [i.id, i]));
  const activeItems = (items.data ?? []).filter((i) => i.isActive);

  return (
    <>
      <PageHeader
        title="Linen & laundry"
        description="Clean store → wards → soiled → laundry → clean store. Items below par level are flagged."
        actions={
          <Can permission="ops.linen.manage">
            <Button variant="outline" onClick={() => setPanel({ name: '', parLevel: '0', isActive: true })}>
              <Plus /> Add item
            </Button>
            <Button onClick={() => setPanel('move')}>
              <ArrowLeftRight /> Record movement
            </Button>
          </Can>
        }
      />

      {canManage && panel === 'move' && (items.data ? <MovementForm items={activeItems} onDone={() => setPanel(null)} /> : <p className="mb-6 text-sm text-muted-foreground">Loading items…</p>)}
      {canManage && panel && panel !== 'move' && <ItemFormCard key={panel.id ?? 'new'} initial={panel} onDone={() => setPanel(null)} />}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Stock</CardTitle>
        </CardHeader>
        {stock.error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(stock.error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Par</TableHead>
                <TableHead className="text-right">Clean</TableHead>
                <TableHead className="text-right">In use</TableHead>
                <TableHead className="text-right">Soiled</TableHead>
                <TableHead className="text-right">At laundry</TableHead>
                <TableHead className="text-right">Condemned</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {stock.isPending ? (
                <MessageRow cols={8}>Loading…</MessageRow>
              ) : stock.data.length === 0 ? (
                <MessageRow cols={8}>No linen items yet. Add bedsheets, pillow covers, gowns etc.</MessageRow>
              ) : (
                stock.data.map((s) => {
                  const item = itemById.get(s.itemId);
                  return (
                    <TableRow key={s.itemId}>
                      <TableCell className="font-medium">
                        {s.name} {s.belowPar && <Badge variant="destructive">Below par</Badge>} {item && !item.isActive && <Badge variant="secondary">Inactive</Badge>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{s.parLevel}</TableCell>
                      <TableCell className={s.belowPar ? 'text-right font-semibold tabular-nums text-destructive' : 'text-right font-semibold tabular-nums'}>{s.clean}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.inUse}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.soiled}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.atLaundry}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{s.condemned}</TableCell>
                      <TableCell className="text-right">
                        {canManage && item && (
                          <Button size="sm" variant="ghost" onClick={() => setPanel({ id: item.id, name: item.name, parLevel: String(item.parLevel), isActive: item.isActive })}>
                            Edit
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <h3 className="font-semibold">Recent movements</h3>
          <Select
            className="w-56"
            aria-label="Movement"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All movements</option>
            {O.LINEN_TXN_KINDS.map((k) => (
              <option key={k} value={k}>
                {LINEN_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </div>
        {txns.error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(txns.error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>When</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Movement</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Reference / notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {txns.isPending ? (
                <MessageRow cols={6}>Loading…</MessageRow>
              ) : txns.data.items.length === 0 ? (
                <MessageRow cols={6}>No movements recorded.</MessageRow>
              ) : (
                txns.data.items.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs">{formatDateTime(t.createdAt)}</TableCell>
                    <TableCell className="font-medium">{t.itemName}</TableCell>
                    <TableCell>
                      {LINEN_KIND_LABELS[t.kind]}
                      {t.fromPool && <span className="text-xs text-muted-foreground"> (from {t.fromPool})</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t.qty}</TableCell>
                    <TableCell>{t.location ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{[t.reference, t.notes].filter(Boolean).join(' · ') || '—'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
        <Pager data={txns.data} page={page} setPage={setPage} />
      </Card>
    </>
  );
}
