'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { inventory } from '@hms/shared';
import { api } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { inr, StatusBadge, statusLabel } from '@/modules/inventory/ui';

export default function PurchaseOrdersPage() {
  const canRead = usePermission('inventory.purchase.read');
  const canOrder = usePermission('inventory.purchase.order');
  const [status, setStatus] = React.useState<inventory.PoStatus | 'open' | ''>('');
  const [q, setQ] = React.useState('');

  const list = useQuery({
    queryKey: ['inventory', 'purchase-orders', status, q],
    queryFn: () =>
      api.inventory.purchaseOrders.list({
        status: status && status !== 'open' ? status : undefined,
        open: status === 'open',
        q: q || undefined,
        pageSize: 100,
      }),
    enabled: canRead,
  });

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Purchase orders"
        description="Orders to vendors. Approve a draft before goods can be received against it."
        actions={
          canOrder && (
            <Link className={buttonVariants()} href="/inventory/purchase-orders/new">
              <Plus /> New PO
            </Link>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-4">
        <Input className="max-w-xs" placeholder="PO number or vendor…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="w-52" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="">All statuses</option>
          <option value="open">Waiting for goods</option>
          {inventory.PO_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </Select>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>PO</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Deliver to</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Expected</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data?.items.length ? (
              list.data.items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link className="font-mono text-xs text-primary hover:underline" href={`/inventory/purchase-orders/${p.id}`}>
                      {p.number}
                    </Link>
                  </TableCell>
                  <TableCell>{p.vendorName}</TableCell>
                  <TableCell>{p.storeName}</TableCell>
                  <TableCell>{formatDate(p.createdAt)}</TableCell>
                  <TableCell>{formatDate(p.expectedDate)}</TableCell>
                  <TableCell>
                    <StatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{inr(p.total)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                  {list.isPending ? 'Loading…' : 'No purchase orders.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
