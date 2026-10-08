'use client';

import * as React from 'react';
import Link from 'next/link';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { buttonVariants } from '@/components/ui/button';
import { BillForm } from '@/modules/billing/bill-form';

/** Edit a draft bill's lines, GST supply and notes. Final and cancelled bills are immutable (use a credit note). */
export default function EditBillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canEdit = usePermission('billing.invoice.create');
  const { data: inv, isPending, error } = useQuery({ queryKey: ['billing', 'invoices', id], queryFn: () => api.billing.invoices.get(id), enabled: canEdit });

  if (!canEdit) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;

  return (
    <div className="max-w-5xl">
      <Link href={`/billing/invoices/${id}`} className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> Back to bill
      </Link>
      <PageHeader title="Edit draft bill" description="Change the lines, GST supply or notes. Leave a price blank to use the price list." />
      {inv.status === 'draft' ? (
        <BillForm key={inv.id} invoice={inv} />
      ) : (
        <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
          This bill is {inv.status} and can no longer be edited. Issue a credit note from the bill instead.
        </p>
      )}
    </div>
  );
}
