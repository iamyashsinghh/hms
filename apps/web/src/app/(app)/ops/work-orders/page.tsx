'use client';

import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { ops as O } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Pager, WO_STATUS, WO_TYPE_LABELS } from '@/modules/ops/ui';
import { WorkOrderTable } from '@/modules/ops/work-orders';

const PAGE_SIZE = 25;

export default function WorkOrdersPage() {
  const canRead = usePermission('ops.asset.read');
  const [status, setStatus] = React.useState('open-any');
  const [type, setType] = React.useState('');
  const [page, setPage] = React.useState(1);

  const query: O.WorkOrderQuery = {
    open: status === 'open-any' ? 'true' : undefined,
    status: status && status !== 'open-any' ? (status as O.WorkOrderStatus) : undefined,
    type: (type || undefined) as O.WorkOrderType | undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ['ops', 'work-orders', query],
    queryFn: () => api.ops.workOrders.list(query),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader title="Maintenance work orders" description="Breakdowns, preventive maintenance and calibration jobs across all equipment." />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <Select
            className="w-48"
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="open-any">Open (not closed)</option>
            <option value="">All statuses</option>
            {O.WORK_ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {WO_STATUS[s].label}
              </option>
            ))}
          </Select>
          <Select
            className="w-48"
            aria-label="Type"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All types</option>
            {O.WORK_ORDER_TYPES.map((t) => (
              <option key={t} value={t}>
                {WO_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
          {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
        {error ? <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p> : <WorkOrderTable items={data?.items} isPending={isPending} />}
        <Pager data={data} page={page} setPage={setPage} />
      </Card>
    </>
  );
}
