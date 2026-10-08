'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { inventory } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { inr, lineTotal, LinesEditor, linesValid, newLine, StoreSelect, useStores, type QtyLine } from '@/modules/inventory/ui';

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const lineOf = (l: inventory.PurchaseOrderLine): QtyLine => newLine({ id: l.itemId, name: l.itemName, unit: l.unit, gstRate: l.gstRate }, String(l.qty), String(l.rate));

/**
 * New purchase order, or edit of a draft one (`po` given). The delivery store is fixed once the PO
 * exists; vendor, expected date, terms, notes and lines can change until it is approved.
 */
export function PurchaseOrderForm({ po, requisition }: { po?: inventory.PurchaseOrder; requisition?: inventory.Requisition }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { stores } = useStores();
  const [vendorId, setVendorId] = React.useState(po?.vendorId ?? '');
  const [storeId, setStoreId] = React.useState(po?.storeId ?? '');
  const [expectedDate, setExpectedDate] = React.useState(po?.expectedDate ?? '');
  const [terms, setTerms] = React.useState(po?.terms ?? '');
  const [notes, setNotes] = React.useState(po?.notes ?? '');
  const [lines, setLines] = React.useState<QtyLine[]>(() => (po?.lines ?? []).map(lineOf));
  const [formError, setFormError] = React.useState<string | null>(null);

  const vendors = useQuery({ queryKey: ['inventory', 'vendors', 'active'], queryFn: () => api.inventory.vendors.list({ pageSize: 200 }) });

  // Prefill from the requisition once; GST comes from the item master.
  const filled = React.useRef(false);
  React.useEffect(() => {
    if (!requisition || filled.current) return;
    filled.current = true;
    setStoreId(requisition.storeId);
    Promise.all((requisition.lines ?? []).map((l) => api.pharmacy.items.get(l.itemId).then((item) => newLine(item, String(l.qty), '')))).then(setLines);
  }, [requisition]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        vendorId,
        expectedDate: expectedDate || undefined,
        terms: terms.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty), rate: Number(l.rate), gstRate: l.gstRate })),
      };
      return po
        ? api.inventory.purchaseOrders.update(po.id, { ...body, expectedDate: expectedDate || null, terms: terms.trim(), notes: notes.trim() })
        : api.inventory.purchaseOrders.create({ ...body, storeId, requisitionId: requisition?.id });
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      router.push(`/inventory/purchase-orders/${saved.id}`);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!vendorId) return setFormError('Choose a vendor');
    if (!storeId) return setFormError('Choose the delivery store');
    if (!lines.length) return setFormError('Add at least one item');
    if (!linesValid(lines, true)) return setFormError('Each line needs a whole-number quantity of 1 or more and a rate');
    if (lines.some((l) => !(Number(l.rate) >= 0))) return setFormError('Rates must be zero or more');
    if (lines.some((l) => !(l.gstRate >= 0 && l.gstRate <= 40))) return setFormError('GST must be between 0 and 40%');
    if (new Set(lines.map((l) => l.itemId)).size !== lines.length) return setFormError('An item is listed twice; combine the lines');
    if (expectedDate && expectedDate < todayIST() && expectedDate !== po?.expectedDate) return setFormError('Expected date cannot be in the past');
    const parsed = inventory.updatePurchaseOrderSchema.safeParse({
      vendorId,
      expectedDate: expectedDate || null,
      terms,
      notes,
      lines: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty), rate: Number(l.rate), gstRate: l.gstRate })),
    });
    if (!parsed.success) return setFormError(parsed.error.issues[0]?.message ?? 'Check the order');
    save.mutate();
  };

  const total = lines.reduce((s, l) => s + lineTotal(l), 0);
  return (
    <form className="space-y-6" onSubmit={submit} noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Order</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Label htmlFor="po-vendor">Vendor *</Label>
            <Select id="po-vendor" className="mt-2" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">Choose a vendor</option>
              {vendors.data?.items.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.code})
                </option>
              ))}
              {po && !vendors.data?.items.some((v) => v.id === po.vendorId) && <option value={po.vendorId}>{po.vendorName}</option>}
            </Select>
          </div>
          <div>
            <Label htmlFor="po-store">Deliver to *</Label>
            <div className="mt-2">
              {po ? (
                <Input id="po-store" value={po.storeName} disabled />
              ) : (
                <StoreSelect id="po-store" value={storeId} onChange={setStoreId} stores={stores} />
              )}
            </div>
          </div>
          <div>
            <Label htmlFor="po-date">Expected on</Label>
            <Input id="po-date" type="date" className="mt-2" min={todayIST()} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="po-terms">Terms</Label>
            <Input id="po-terms" className="mt-2" maxLength={1000} placeholder="Delivery, payment, warranty…" value={terms} onChange={(e) => setTerms(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="po-notes">Notes</Label>
            <Input id="po-notes" className="mt-2" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent>
          <LinesEditor lines={lines} setLines={setLines} withRate />
        </CardContent>
      </Card>
      {(formError || save.error) && <p className="text-sm text-destructive">{formError ?? errorMessage(save.error)}</p>}
      <div className="flex items-center justify-end gap-4">
        {lines.length > 0 && <span className="text-sm text-muted-foreground">Total incl. GST {inr(total)}</span>}
        {po && (
          <Button type="button" variant="outline" onClick={() => router.push(`/inventory/purchase-orders/${po.id}`)}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />}
          {po ? 'Save changes' : 'Save draft'}
        </Button>
      </div>
    </form>
  );
}
