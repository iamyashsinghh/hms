'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { inventory } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { validate } from '@/lib/validate';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formErrorMessage, LinesEditor, linesValid, newLine, StoreSelect, useStores, type QtyLine } from '@/modules/inventory/ui';

/**
 * New indent, or edit of one that is still waiting for a decision (`indent` given). The stores are
 * fixed once the indent exists; priority, notes and lines can change until it is approved.
 */
export function IndentForm({ indent }: { indent?: inventory.Indent }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { stores } = useStores();
  const [toStoreId, setToStoreId] = React.useState(indent?.toStoreId ?? '');
  const [fromStoreId, setFromStoreId] = React.useState(indent?.fromStoreId ?? '');
  const [priority, setPriority] = React.useState<'normal' | 'urgent'>(indent?.priority ?? 'normal');
  const [notes, setNotes] = React.useState(indent?.notes ?? '');
  const [lines, setLines] = React.useState<QtyLine[]>(() =>
    (indent?.lines ?? []).map((l) => newLine({ id: l.itemId, name: l.itemName, unit: l.unit, gstRate: 0 }, String(l.requestedQty))),
  );
  const [formError, setFormError] = React.useState<string | null>(null);
  const supplier = fromStoreId || stores.find((s) => s.type === 'main' && s.id !== toStoreId)?.id || '';

  const body = () => ({ priority, notes: notes.trim(), lines: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })) });
  const save = useMutation({
    mutationFn: () =>
      indent
        ? api.inventory.indents.update(indent.id, body())
        : api.inventory.indents.create({ ...body(), toStoreId, fromStoreId: supplier, notes: notes.trim() || undefined }),
    onSuccess: (i) => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'indents'] });
      router.push(`/inventory/indents/${i.id}`);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!indent && (!toStoreId || !supplier)) return setFormError('Choose both stores');
    if (!indent && toStoreId === supplier) return setFormError('The asking store and the supplying store must differ');
    if (!lines.length) return setFormError('Add at least one item');
    if (!linesValid(lines)) return setFormError('Each quantity must be a whole number of 1 or more');
    const r = indent
      ? validate(inventory.updateIndentSchema, body())
      : validate(inventory.createIndentSchema, { ...body(), toStoreId, fromStoreId: supplier, notes: notes.trim() || undefined });
    const problem = formErrorMessage(r.errors, lines);
    if (problem) return setFormError(problem);
    save.mutate();
  };

  return (
    <form className="space-y-6" onSubmit={submit} noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Indent</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-4">
          <div>
            <Label htmlFor="ind-to">For (your store) *</Label>
            <div className="mt-2">
              {indent ? <Input id="ind-to" value={indent.toStoreName} disabled /> : <StoreSelect id="ind-to" value={toStoreId} onChange={setToStoreId} stores={stores} />}
            </div>
          </div>
          <div>
            <Label htmlFor="ind-from">From *</Label>
            <div className="mt-2">
              {indent ? (
                <Input id="ind-from" value={indent.fromStoreName} disabled />
              ) : (
                <StoreSelect id="ind-from" value={supplier} onChange={setFromStoreId} stores={stores.filter((s) => s.id !== toStoreId)} />
              )}
            </div>
          </div>
          <div>
            <Label htmlFor="ind-priority">Priority</Label>
            <Select id="ind-priority" className="mt-2" value={priority} onChange={(e) => setPriority(e.target.value as 'normal' | 'urgent')}>
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="ind-notes">Notes</Label>
            <Input id="ind-notes" className="mt-2" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent>
          <LinesEditor lines={lines} setLines={setLines} />
        </CardContent>
      </Card>
      {(formError || save.error) && <p className="text-sm text-destructive">{formError ?? errorMessage(save.error)}</p>}
      <div className="flex justify-end gap-2">
        {indent && (
          <Button type="button" variant="outline" onClick={() => router.push(`/inventory/indents/${indent.id}`)}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />}
          {indent ? 'Save changes' : 'Submit indent'}
        </Button>
      </div>
    </form>
  );
}
