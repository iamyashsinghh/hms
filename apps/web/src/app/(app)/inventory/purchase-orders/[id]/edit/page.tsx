'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { PurchaseOrderForm } from '@/modules/inventory/po-form';
import { statusLabel } from '@/modules/inventory/ui';

export default function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canOrder = usePermission('inventory.purchase.order');
  const po = useQuery({ queryKey: ['inventory', 'purchase-orders', id], queryFn: () => api.inventory.purchaseOrders.get(id), enabled: canOrder });

  if (!canOrder) return <NoAccess />;
  if (po.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (po.error) return <p className="text-sm text-destructive">{errorMessage(po.error)}</p>;
  const p = po.data;

  return (
    <>
      <Link href={`/inventory/purchase-orders/${id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {p.number}
      </Link>
      <PageHeader title={`Edit ${p.number}`} description="Drafts can be changed until they are approved. The lines you save replace the old ones." />
      {p.status === 'draft' ? (
        <PurchaseOrderForm key={p.id} po={p} />
      ) : (
        <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">This purchase order is {statusLabel(p.status).toLowerCase()} and can no longer be edited.</p>
      )}
    </>
  );
}
