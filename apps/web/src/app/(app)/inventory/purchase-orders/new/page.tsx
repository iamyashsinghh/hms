'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { inr, lineTotal, LinesEditor, linesValid, newLine, StoreSelect, useStores, type QtyLine } from '@/modules/inventory/ui';

export default function NewPurchaseOrderPage() {
  return (
    <React.Suspense fallback={null}>
      <NewPurchaseOrder />
    </React.Suspense>
  );
}

function NewPurchaseOrder() {
  const canOrder = usePermission('inventory.purchase.order');
  const router = useRouter();
  const queryClient = useQueryClient();
  const requisitionId = useSearchParams().get('requisitionId') ?? undefined;
  const { stores } = useStores();
  const [vendorId, setVendorId] = React.useState('');
  const [storeId, setStoreId] = React.useState('');
  const [expectedDate, setExpectedDate] = React.useState('');
  const [terms, setTerms] = React.useState('');
  const [lines, setLines] = React.useState<QtyLine[]>([]);

  const vendors = useQuery({ queryKey: ['inventory', 'vendors', 'active'], queryFn: () => api.inventory.vendors.list({ pageSize: 200 }), enabled: canOrder });
  const requisition = useQuery({
    queryKey: ['inventory', 'requisitions', 'detail', requisitionId],
    queryFn: () => api.inventory.requisitions.get(requisitionId!),
    enabled: !!requisitionId && canOrder,
  });

  // Prefill from the requisition once; GST comes from the item master.
  const filled = React.useRef(false);
  React.useEffect(() => {
    const req = requisition.data;
    if (!req || filled.current) return;
    filled.current = true;
    setStoreId(req.storeId);
    Promise.all((req.lines ?? []).map((l) => api.pharmacy.items.get(l.itemId).then((item) => newLine(item, String(l.qty), '')))).then(setLines);
  }, [requisition.data]);

  const save = useMutation({
    mutationFn: () =>
      api.inventory.purchaseOrders.create({
        vendorId,
        storeId,
        requisitionId,
        expectedDate: expectedDate || undefined,
        terms: terms || undefined,
        lines: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty), rate: Number(l.rate), gstRate: l.gstRate })),
      }),
    onSuccess: (po) => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      router.push(`/inventory/purchase-orders/${po.id}`);
    },
  });

  if (!canOrder) return <NoAccess />;
  const total = lines.reduce((s, l) => s + lineTotal(l), 0);

  return (
    <>
      <PageHeader title="New purchase order" description={requisition.data ? `From requisition ${requisition.data.number}` : 'Saved as a draft; an approver releases it to the vendor.'} />
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
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
              </Select>
            </div>
            <div>
              <Label htmlFor="po-store">Deliver to *</Label>
              <div className="mt-2">
                <StoreSelect id="po-store" value={storeId} onChange={setStoreId} stores={stores} />
              </div>
            </div>
            <div>
              <Label htmlFor="po-date">Expected on</Label>
              <Input id="po-date" type="date" className="mt-2" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </div>
            <div className="sm:col-span-4">
              <Label htmlFor="po-terms">Terms</Label>
              <Input id="po-terms" className="mt-2" placeholder="Delivery, payment, warranty…" value={terms} onChange={(e) => setTerms(e.target.value)} />
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
        {save.error && <p className="text-sm text-destructive">{errorMessage(save.error)}</p>}
        <div className="flex items-center justify-end gap-4">
          {lines.length > 0 && <span className="text-sm text-muted-foreground">Total incl. GST {inr(total)}</span>}
          <Button type="submit" disabled={!vendorId || !storeId || !linesValid(lines, true) || save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />}
            Save draft
          </Button>
        </div>
      </form>
    </>
  );
}
