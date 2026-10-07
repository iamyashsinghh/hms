'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { inr } from '@/modules/inventory/ui';

export default function GrnsPage() {
  const canRead = usePermission('inventory.purchase.read');
  const list = useQuery({ queryKey: ['inventory', 'grns'], queryFn: () => api.inventory.grns.list({ pageSize: 100 }), enabled: canRead });
  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader title="Goods received" description="Receipts against purchase orders. Open a purchase order to receive goods." />
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>GRN</TableHead>
              <TableHead>PO</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data?.items.length ? (
              list.data.items.map((g) => (
                <TableRow key={g.id}>
                  <TableCell>
                    <Link className="font-mono text-xs text-primary hover:underline" href={`/inventory/grns/${g.id}`}>
                      {g.number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link className="font-mono text-xs hover:underline" href={`/inventory/purchase-orders/${g.purchaseOrderId}`}>
                      {g.poNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{g.vendorName}</TableCell>
                  <TableCell>{g.invoiceNo ?? '—'}</TableCell>
                  <TableCell>{formatDate(g.createdAt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(g.total)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  {list.isPending ? 'Loading…' : 'No goods received yet.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
