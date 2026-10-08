'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { PurchaseOrderForm } from '@/modules/inventory/po-form';

export default function NewPurchaseOrderPage() {
  return (
    <React.Suspense fallback={null}>
      <NewPurchaseOrder />
    </React.Suspense>
  );
}

function NewPurchaseOrder() {
  const canOrder = usePermission('inventory.purchase.order');
  const requisitionId = useSearchParams().get('requisitionId') ?? undefined;
  const requisition = useQuery({
    queryKey: ['inventory', 'requisitions', 'detail', requisitionId],
    queryFn: () => api.inventory.requisitions.get(requisitionId!),
    enabled: !!requisitionId && canOrder,
  });

  if (!canOrder) return <NoAccess />;

  return (
    <>
      <PageHeader title="New purchase order" description={requisition.data ? `From requisition ${requisition.data.number}` : 'Saved as a draft; an approver releases it to the vendor.'} />
      <PurchaseOrderForm requisition={requisition.data} />
    </>
  );
}
