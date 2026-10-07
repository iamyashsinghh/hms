'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { ErrorBox, StatusBadge, humanize } from '@/modules/platform/ui';
import { TicketThread } from '@/modules/platform/ticket-thread';

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const can = usePermission('platform.ticket.create');
  const qc = useQueryClient();
  const [reply, setReply] = React.useState('');
  const t = useQuery({ queryKey: ['platform', 'ticket', id], queryFn: () => api.platform.ticket(id), enabled: can });
  const onDone = (d: Awaited<ReturnType<typeof api.platform.ticket>>) => {
    qc.setQueryData(['platform', 'ticket', id], d);
    qc.invalidateQueries({ queryKey: ['platform', 'tickets'] });
  };
  const send = useMutation({ mutationFn: () => api.platform.replyTicket(id, reply), onSuccess: (d) => (setReply(''), onDone(d)) });
  const resolve = useMutation({ mutationFn: () => api.platform.resolveTicket(id), onSuccess: onDone });

  if (!can) return <NoAccess />;
  if (t.isPending) return <Loader2 className="mx-auto mt-16 size-6 animate-spin text-muted-foreground" />;
  if (t.error) return <ErrorBox error={t.error} />;
  const ticket = t.data;
  const closed = ticket.status === 'closed';

  return (
    <div className="max-w-3xl">
      <Link href="/platform/support" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> Help & support
      </Link>
      <PageHeader
        title={ticket.subject}
        description={
          <span className="flex items-center gap-2">
            {ticket.number} · {humanize(ticket.category)} · <StatusBadge status={ticket.status} />
          </span>
        }
        actions={
          !closed &&
          ticket.status !== 'resolved' && (
            <Button variant="outline" onClick={() => resolve.mutate()} disabled={resolve.isPending}>
              Mark resolved
            </Button>
          )
        }
      />
      <TicketThread messages={ticket.messages} mine="staff" />
      {!closed && (
        <form
          className="mt-4 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (reply.trim()) send.mutate();
          }}
        >
          <ErrorBox error={send.error ?? resolve.error} />
          <textarea
            rows={4}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Write a reply…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={send.isPending || !reply.trim()}>
              {send.isPending && <Loader2 className="animate-spin" />} Send reply
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
