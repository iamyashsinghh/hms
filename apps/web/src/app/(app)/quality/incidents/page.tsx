'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FilePlus2, Search } from 'lucide-react';
import { quality as Q } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CATEGORY_LABELS, EnumSelect } from '@/modules/quality/ui';
import { IncidentTable } from './list';

export default function IncidentsPage() {
  const can = usePermission('quality.incident.read');
  const [status, setStatus] = React.useState<Q.IncidentStatus | ''>('');
  const [category, setCategory] = React.useState<Q.IncidentCategory | ''>('');
  const [kind, setKind] = React.useState<Q.IncidentKind | ''>('');
  const [q, setQ] = React.useState('');
  const [page, setPage] = React.useState(1);
  const query = { status: status || undefined, category: category || undefined, kind: kind || undefined, q: q.trim() || undefined, page, pageSize: 25 };
  const { data, isPending, error } = useQuery({
    queryKey: ['quality', 'incidents', query],
    queryFn: () => api.quality.incidents.list(query),
    placeholderData: keepPreviousData,
    enabled: can,
  });
  if (!can) return <NoAccess />;
  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };
  return (
    <>
      <PageHeader
        title="Incidents"
        description="Incidents, near misses, adverse and sentinel events reported by staff."
        actions={
          <Link href="/quality/incidents/new" className={buttonVariants()}>
            <FilePlus2 /> Report incident
          </Link>
        }
      />
      {error && <p className="mb-4 text-sm text-destructive">{errorMessage(error)}</p>}
      <IncidentTable
        data={data}
        isPending={isPending}
        page={page}
        setPage={setPage}
        toolbar={
          <>
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" className="pl-9" placeholder="IR number, words, place" value={q} onChange={(e) => reset(setQ)(e.target.value)} />
            </div>
            <div className="w-40">
              <EnumSelect value={status} onChange={reset(setStatus)} options={Q.INCIDENT_STATUSES} placeholder="Any status" />
            </div>
            <div className="w-52">
              <EnumSelect value={category} onChange={reset(setCategory)} options={Q.INCIDENT_CATEGORIES} labels={CATEGORY_LABELS} placeholder="Any category" />
            </div>
            <div className="w-40">
              <EnumSelect value={kind} onChange={reset(setKind)} options={Q.INCIDENT_KINDS} placeholder="Any type" />
            </div>
          </>
        }
      />
    </>
  );
}
