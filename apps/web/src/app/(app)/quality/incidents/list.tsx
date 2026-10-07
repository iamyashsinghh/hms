'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { Paginated, quality as Q } from '@hms/shared';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CATEGORY_LABELS, Pager, SeverityBadge, StatusBadge, formatDateTime, humanize } from '@/modules/quality/ui';

/** Incident table shared by "Incidents" and "My reports". */
export function IncidentTable({
  data,
  isPending,
  page,
  setPage,
  toolbar,
  showReporter = true,
}: {
  data: Paginated<Q.IncidentSummary> | undefined;
  isPending: boolean;
  page: number;
  setPage: (p: number) => void;
  toolbar?: React.ReactNode;
  showReporter?: boolean;
}) {
  const router = useRouter();
  const cols = showReporter ? 7 : 6;
  return (
    <Card>
      {toolbar && <div className="flex flex-wrap items-center gap-3 border-b p-4">{toolbar}</div>}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>No.</TableHead>
            <TableHead>Occurred</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Harm</TableHead>
            {showReporter && <TableHead>Reported by</TableHead>}
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <TableRow>
              <TableCell colSpan={cols} className="py-10 text-center text-muted-foreground">
                Loading…
              </TableCell>
            </TableRow>
          ) : !data?.items.length ? (
            <TableRow>
              <TableCell colSpan={cols} className="py-10 text-center text-muted-foreground">
                No incidents found.
              </TableCell>
            </TableRow>
          ) : (
            data.items.map((i) => (
              <TableRow key={i.id} className="cursor-pointer" onClick={() => router.push(`/quality/incidents/${i.id}`)}>
                <TableCell className="font-mono text-xs">{i.incidentNo}</TableCell>
                <TableCell>{formatDateTime(i.occurredAt)}</TableCell>
                <TableCell>
                  {CATEGORY_LABELS[i.category]}
                  {i.location && <div className="text-xs text-muted-foreground">{i.location}</div>}
                </TableCell>
                <TableCell>{humanize(i.kind)}</TableCell>
                <TableCell>
                  <SeverityBadge severity={i.severity} />
                </TableCell>
                {showReporter && <TableCell>{i.isAnonymous ? <span className="text-muted-foreground">Anonymous</span> : (i.reportedBy?.name ?? '—')}</TableCell>}
                <TableCell>
                  <StatusBadge status={i.status} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <Pager data={data} page={page} setPage={setPage} />
    </Card>
  );
}
