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
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge, statusLabel, StoreSelect, useStores } from '@/modules/inventory/ui';

export default function IndentsPage() {
  const canRead = usePermission('inventory.indent.read');
  const canCreate = usePermission('inventory.indent.create');
  const { stores } = useStores();
  const [status, setStatus] = React.useState<inventory.IndentStatus | 'pending' | ''>('');
  const [storeId, setStoreId] = React.useState('');

  const list = useQuery({
    queryKey: ['inventory', 'indents', status, storeId],
    queryFn: () =>
      api.inventory.indents.list({
        status: status && status !== 'pending' ? status : undefined,
        pending: status === 'pending',
        storeId: storeId || undefined,
        pageSize: 100,
      }),
    enabled: canRead,
  });

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Indents"
        description="Wards, OT and pharmacy ask the central store for supplies; the store approves and issues."
        actions={
          canCreate && (
            <Link className={buttonVariants()} href="/inventory/indents/new">
              <Plus /> New indent
            </Link>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-4">
        <Select className="w-52" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="">All statuses</option>
          <option value="pending">Waiting to be issued</option>
          {inventory.INDENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </Select>
        <div className="w-64">
          <StoreSelect value={storeId} onChange={setStoreId} stores={stores} placeholder="All stores" />
        </div>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Indent</TableHead>
              <TableHead>For</TableHead>
              <TableHead>From</TableHead>
              <TableHead>Raised</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data?.items.length ? (
              list.data.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <Link className="font-mono text-xs text-primary hover:underline" href={`/inventory/indents/${i.id}`}>
                      {i.number}
                    </Link>{' '}
                    {i.priority === 'urgent' && <Badge variant="destructive">Urgent</Badge>}
                  </TableCell>
                  <TableCell>{i.toStoreName}</TableCell>
                  <TableCell>{i.fromStoreName}</TableCell>
                  <TableCell>{formatDate(i.createdAt)}</TableCell>
                  <TableCell>
                    <StatusBadge status={i.status} />
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  {list.isPending ? 'Loading…' : 'No indents.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
