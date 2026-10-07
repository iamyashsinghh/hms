'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2, RotateCcw, Search, Send } from 'lucide-react';
import { notifications as n } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CHANNEL_LABELS, ChannelBadge, REASON_LABELS, StatusBadge, formatDateTime, rupees } from '@/modules/notifications/ui';

const PAGE_SIZE = 25;

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold ${tone ?? ''}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

export default function MessagesPage() {
  const canRead = usePermission('notifications.message.read');
  const canSend = usePermission('notifications.message.send');
  const canCredits = usePermission('notifications.credit.read');
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState<n.MessageStatus | ''>('');
  const [channel, setChannel] = React.useState<n.Channel | ''>('');
  const [page, setPage] = React.useState(1);
  const [open, setOpen] = React.useState<string | null>(null);
  const q = useDebounced(search.trim());

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ['notifications', 'messages', { q, status, channel, page }],
    queryFn: () => api.notifications.messages({ q: q || undefined, status: status || undefined, channel: channel || undefined, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });
  const stats = useQuery({ queryKey: ['notifications', 'stats'], queryFn: () => api.notifications.stats(), enabled: canRead });
  const credits = useQuery({ queryKey: ['notifications', 'credits'], queryFn: () => api.notifications.credits(), enabled: canCredits });

  const retry = useMutation({
    mutationFn: (id: string) => api.notifications.retry(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  if (!canRead) return <NoAccess />;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const today = stats.data?.today;

  return (
    <>
      <PageHeader
        title="Messages"
        description="Every SMS, WhatsApp, email and push sent by the hospital, with delivery status."
        actions={
          <Can permission="notifications.message.send">
            <Link href="/notifications/send" className={buttonVariants()}>
              <Send /> Send message
            </Link>
          </Can>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Delivered today" value={today ? today.delivered + today.sent : '—'} />
        <Stat label="Queued" value={today?.queued ?? '—'} />
        <Stat label="Failed today" value={today?.failed ?? '—'} tone={today?.failed ? 'text-destructive' : ''} />
        <Stat label="Skipped today" value={today?.skipped ?? '—'} />
        {canCredits && (
          <Link href="/notifications/settings">
            <Stat label="Credit balance" value={credits.data ? rupees(credits.data.balance) : '—'} tone={credits.data?.low ? 'text-destructive' : ''} />
          </Link>
        )}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Mobile, email or text…"
              className="pl-9"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            aria-label="Status"
            className="w-36"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as n.MessageStatus | '');
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {n.MESSAGE_STATUSES.map((s) => (
              <option key={s} value={s} className="capitalize">
                {s}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Channel"
            className="w-36"
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value as n.Channel | '');
              setPage(1);
            }}
          >
            <option value="">All channels</option>
            {n.CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABELS[c]}
              </option>
            ))}
          </Select>
          {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>

        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Time</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No messages yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.flatMap((m) => [
                  <TableRow key={m.id} className="cursor-pointer" onClick={() => setOpen(open === m.id ? null : m.id)}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(m.createdAt)}</TableCell>
                    <TableCell>
                      <ChannelBadge channel={m.channel} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{m.channel === 'push' ? 'Device' : (m.recipient ?? '—')}</TableCell>
                    <TableCell className="max-w-md truncate">{m.body || <span className="text-muted-foreground">{m.templateKey}</span>}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={m.status} />
                        {m.reason && <span className="text-xs text-muted-foreground">{REASON_LABELS[m.reason] ?? m.reason}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{m.cost ? rupees(m.cost) : '—'}</TableCell>
                  </TableRow>,
                  open === m.id && (
                    <TableRow key={`${m.id}-detail`} className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={6}>
                        <dl className="grid gap-3 py-2 text-sm sm:grid-cols-4">
                          <div className="sm:col-span-4">
                            {m.subject && <p className="font-medium">{m.subject}</p>}
                            <p className="whitespace-pre-wrap">{m.body}</p>
                          </div>
                          <div>
                            <dt className="text-xs text-muted-foreground">Template</dt>
                            <dd className="font-mono text-xs">{m.templateKey}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted-foreground">Source</dt>
                            <dd>{m.sourceModule ?? '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted-foreground">Provider</dt>
                            <dd>
                              {m.provider ?? '—'} {m.attempts > 0 && <span className="text-muted-foreground">({m.attempts} attempt{m.attempts > 1 ? 's' : ''})</span>}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted-foreground">Sent / delivered</dt>
                            <dd>
                              {formatDateTime(m.sentAt)} / {formatDateTime(m.deliveredAt)}
                            </dd>
                          </div>
                          {m.error && <p className="text-destructive sm:col-span-4">{m.error}</p>}
                          {m.status === 'failed' && canSend && (
                            <div className="sm:col-span-4">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={retry.isPending}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  retry.mutate(m.id);
                                }}
                              >
                                {retry.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />} Retry
                              </Button>
                              {retry.error && <span className="ml-3 text-destructive">{errorMessage(retry.error)}</span>}
                            </div>
                          )}
                        </dl>
                      </TableCell>
                    </TableRow>
                  ),
                ])
              )}
            </TableBody>
          </Table>
        )}

        {data && data.total > 0 && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
            <span>
              {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft /> Prev
              </Button>
              <span>
                Page {page} of {pages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
