'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Plus, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AnnouncementsBanner, ErrorBox, StatusBadge, dateTime } from '@/modules/platform/ui';

export default function SupportPage() {
  const can = usePermission('platform.ticket.create');
  const [q, setQ] = React.useState('');
  const tickets = useQuery({ queryKey: ['platform', 'tickets'], queryFn: () => api.platform.tickets({ pageSize: 50 }), enabled: can });
  const help = useQuery({ queryKey: ['platform', 'help', q], queryFn: () => api.platform.help({ q: q.trim() || undefined }), enabled: can });

  if (!can) return <NoAccess />;
  return (
    <>
      <PageHeader
        title="Help & support"
        description="Search the guides or raise a ticket with the HMS team."
        actions={
          <Link href="/platform/support/new" className={buttonVariants()}>
            <Plus /> New ticket
          </Link>
        }
      />
      <AnnouncementsBanner className="mb-6" />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Your tickets</CardTitle>
          </CardHeader>
          {tickets.error ? (
            <CardContent>
              <ErrorBox error={tickets.error} />
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Ticket</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.data?.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      No tickets yet.
                    </TableCell>
                  </TableRow>
                )}
                {tickets.data?.items.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Link href={`/platform/support/${t.id}`} className="font-medium text-primary hover:underline">
                        {t.subject}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {t.number} · {t.raisedByName}
                      </p>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={t.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{dateTime(t.lastActivityAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Guides</CardTitle>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" placeholder="Search help…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {help.data?.length === 0 && <p className="text-sm text-muted-foreground">No guides match.</p>}
            {help.data?.map((a) => (
              <Link key={a.id} href={`/platform/help/${a.slug}`} className="flex gap-3 rounded-md p-2 hover:bg-muted">
                <BookOpen className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-medium">{a.title}</p>
                  <p className="text-xs text-muted-foreground">{a.summary}</p>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
