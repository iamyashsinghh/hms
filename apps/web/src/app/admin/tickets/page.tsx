'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { platform } from '@hms/shared';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { consoleApi } from '@/modules/platform/console/session';
import { ErrorBox, StatusBadge, dateTime, humanize } from '@/modules/platform/ui';

export default function ConsoleTicketsPage() {
  const [status, setStatus] = React.useState<string>('open');
  const list = useQuery({
    queryKey: ['console', 'tickets', status],
    queryFn: () => consoleApi.tickets({ status: (status || undefined) as platform.TicketStatus | undefined, pageSize: 100 }),
  });
  return (
    <>
      <PageHeader title="Support tickets" description={list.data ? `${list.data.total} tickets` : undefined} />
      <Card>
        <div className="border-b p-4">
          <Select className="max-w-[14rem]" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {platform.TICKET_STATUSES.map((s) => (
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
              <TableHead>Ticket</TableHead>
              <TableHead>Hospital</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Assignee</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data?.items.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <Link href={`/admin/tickets/${t.id}`} className="font-medium text-primary hover:underline">
                    {t.subject}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {t.number} · {humanize(t.category)} · {t.raisedByName}
                  </p>
                </TableCell>
                <TableCell>{t.tenantName}</TableCell>
                <TableCell>
                  <StatusBadge status={t.priority} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={t.status} />
                </TableCell>
                <TableCell>{t.assignedAdminName ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{dateTime(t.lastActivityAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
