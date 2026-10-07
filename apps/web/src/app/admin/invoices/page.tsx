'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { consoleApi } from '@/modules/platform/console/session';
import { useIsSuperAdmin } from '@/modules/platform/console/shell';
import { ErrorBox, StatusBadge, inr } from '@/modules/platform/ui';

export default function ConsoleInvoicesPage() {
  const [status, setStatus] = React.useState<'' | 'issued' | 'paid' | 'void'>('issued');
  const isSuper = useIsSuperAdmin();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['console', 'invoices', status], queryFn: () => consoleApi.invoices({ status: status || undefined, pageSize: 100 }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['console'] });
  const pay = useMutation({ mutationFn: (id: string) => consoleApi.markInvoicePaid(id, { mode: 'bank_transfer' }), onSuccess: refresh });
  const voidInv = useMutation({ mutationFn: (id: string) => consoleApi.voidInvoice(id), onSuccess: refresh });
  return (
    <>
      <PageHeader title="Subscription invoices" description="Payments run in sandbox mode; real gateways are not connected yet." />
      <Card>
        <div className="border-b p-4">
          <Select className="max-w-[12rem]" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="">All</option>
            <option value="issued">Unpaid</option>
            <option value="paid">Paid</option>
            <option value="void">Void</option>
          </Select>
        </div>
        <ErrorBox error={list.error ?? pay.error ?? voidInv.error} />
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Number</TableHead>
              <TableHead>Hospital</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data?.items.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-mono text-xs">{i.number}</TableCell>
                <TableCell>
                  <Link href={`/admin/tenants/${i.tenantId}`} className="text-primary hover:underline">
                    {i.tenantName}
                  </Link>
                </TableCell>
                <TableCell className="capitalize">
                  {i.planCode} · {i.billingCycle}
                </TableCell>
                <TableCell>{inr(i.total)}</TableCell>
                <TableCell>{formatDate(i.dueAt)}</TableCell>
                <TableCell>
                  <StatusBadge status={i.status} />
                </TableCell>
                <TableCell className="space-x-2 text-right">
                  {isSuper && i.status === 'issued' && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => pay.mutate(i.id)}>
                        Mark paid
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => voidInv.mutate(i.id)}>
                        Void
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
