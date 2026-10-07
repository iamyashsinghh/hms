'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LinesEditor, linesValid, StoreSelect, useStores, type QtyLine } from '@/modules/inventory/ui';

export default function NewIndentPage() {
  const canCreate = usePermission('inventory.indent.create');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { stores } = useStores();
  const [toStoreId, setToStoreId] = React.useState('');
  const [fromStoreId, setFromStoreId] = React.useState('');
  const [priority, setPriority] = React.useState<'normal' | 'urgent'>('normal');
  const [notes, setNotes] = React.useState('');
  const [lines, setLines] = React.useState<QtyLine[]>([]);
  const supplier = fromStoreId || stores.find((s) => s.type === 'main' && s.id !== toStoreId)?.id || '';

  const save = useMutation({
    mutationFn: () =>
      api.inventory.indents.create({
        toStoreId,
        fromStoreId: supplier,
        priority,
        notes: notes || undefined,
        lines: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })),
      }),
    onSuccess: (i) => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'indents'] });
      router.push(`/inventory/indents/${i.id}`);
    },
  });

  if (!canCreate) return <NoAccess />;

  return (
    <>
      <PageHeader title="New indent" description="Ask the central store for supplies for your ward or department." />
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Indent</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-4">
            <div>
              <Label htmlFor="ind-to">For (your store) *</Label>
              <div className="mt-2">
                <StoreSelect id="ind-to" value={toStoreId} onChange={setToStoreId} stores={stores} />
              </div>
            </div>
            <div>
              <Label htmlFor="ind-from">From *</Label>
              <div className="mt-2">
                <StoreSelect id="ind-from" value={supplier} onChange={setFromStoreId} stores={stores.filter((s) => s.id !== toStoreId)} />
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
              <Input id="ind-notes" className="mt-2" value={notes} onChange={(e) => setNotes(e.target.value)} />
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
        {save.error && <p className="text-sm text-destructive">{errorMessage(save.error)}</p>}
        <div className="flex justify-end">
          <Button type="submit" disabled={!toStoreId || !supplier || toStoreId === supplier || !linesValid(lines) || save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />}
            Submit indent
          </Button>
        </div>
      </form>
    </>
  );
}
