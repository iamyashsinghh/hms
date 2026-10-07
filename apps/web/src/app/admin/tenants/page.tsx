'use client';

import * as React from 'react';
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { platform } from '@hms/shared';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { consoleApi } from '@/modules/platform/console/session';
import { useIsSuperAdmin } from '@/modules/platform/console/shell';
import { ErrorBox, StatusBadge, humanize } from '@/modules/platform/ui';

function TenantList() {
  const params = useSearchParams();
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState(params.get('status') ?? '');
  const isSuper = useIsSuperAdmin();
  const list = useQuery({
    queryKey: ['console', 'tenants', q, status],
    queryFn: () => consoleApi.tenants({ q: q || undefined, status: (status || undefined) as platform.TenantStatus | undefined, pageSize: 100 }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader
        title="Hospitals"
        description={list.data ? `${list.data.total} hospitals` : undefined}
        actions={
          isSuper && (
            <Link href="/admin/tenants/new" className={buttonVariants()}>
              <Plus /> Add hospital
            </Link>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b p-4">
          <Input placeholder="Search name or code…" className="max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select className="max-w-[12rem]" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {platform.TENANT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        </div>
        <ErrorBox error={list.error} />
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Hospital</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Trial ends / renews</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data?.items.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <Link href={`/admin/tenants/${t.id}`} className="font-medium text-primary hover:underline">
                    {t.name}
                  </Link>
                  <p className="font-mono text-xs text-muted-foreground">{t.code}</p>
                </TableCell>
                <TableCell className="capitalize">{t.planCode}</TableCell>
                <TableCell className="space-x-1">
                  <StatusBadge status={t.status} />
                  {t.subscriptionStatus && t.subscriptionStatus !== t.status && <StatusBadge status={t.subscriptionStatus} />}
                </TableCell>
                <TableCell>{formatDate(t.subscriptionStatus === 'trial' ? t.trialEndsAt : t.currentPeriodEnd)}</TableCell>
                <TableCell>{formatDate(t.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

export default function TenantsPage() {
  return (
    <Suspense>
      <TenantList />
    </Suspense>
  );
}
