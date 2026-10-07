'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FilePlus2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { buttonVariants } from '@/components/ui/button';
import { IncidentTable } from '../list';

export default function MyReportsPage() {
  const can = usePermission('quality.incident.report');
  const [page, setPage] = React.useState(1);
  const { data, isPending, error } = useQuery({
    queryKey: ['quality', 'incidents', 'mine', page],
    queryFn: () => api.quality.incidents.mine({ page, pageSize: 25 }),
    placeholderData: keepPreviousData,
    enabled: can,
  });
  if (!can) return <NoAccess />;
  return (
    <>
      <PageHeader
        title="My incident reports"
        description="Reports you filed with your name, and where they are in review. Anonymous reports are not listed."
        actions={
          <Link href="/quality/incidents/new" className={buttonVariants()}>
            <FilePlus2 /> Report incident
          </Link>
        }
      />
      {error && <p className="mb-4 text-sm text-destructive">{errorMessage(error)}</p>}
      <IncidentTable data={data} isPending={isPending} page={page} setPage={setPage} showReporter={false} />
    </>
  );
}
