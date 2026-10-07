'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { platform } from '@hms/shared';
import { PageHeader } from '@/components/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { consoleApi, useConsole } from '@/modules/platform/console/session';
import { ErrorBox, humanize } from '@/modules/platform/ui';
import { TicketThread } from '@/modules/platform/ticket-thread';

export default function ConsoleTicketPage() {
  const { id } = useParams<{ id: string }>();
  const { admin } = useConsole();
  const qc = useQueryClient();
  const [body, setBody] = React.useState('');
  const [internal, setInternal] = React.useState(false);
  const t = useQuery({ queryKey: ['console', 'ticket', id], queryFn: () => consoleApi.ticket(id) });
  const done = (d: platform.TicketDetail) => {
    qc.setQueryData(['console', 'ticket', id], d);
    qc.invalidateQueries({ queryKey: ['console', 'tickets'] });
  };
  const reply = useMutation({ mutationFn: () => consoleApi.replyTicket(id, { body, isInternal: internal }), onSuccess: (d) => (setBody(''), done(d)) });
  const update = useMutation({ mutationFn: (p: platform.UpdateTicket) => consoleApi.updateTicket(id, p), onSuccess: done });

  if (t.isPending) return <Loader2 className="mx-auto mt-16 size-6 animate-spin text-muted-foreground" />;
  if (t.error) return <ErrorBox error={t.error} />;
  const k = t.data;
  return (
    <div className="max-w-4xl">
      <Link href="/admin/tickets" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> Tickets
      </Link>
      <PageHeader
        title={k.subject}
        description={
          <>
            {k.number} · {humanize(k.category)} · raised by {k.raisedByName} ·{' '}
            <Link href={`/admin/tenants/${k.tenantId}`} className="text-primary hover:underline">
              hospital
            </Link>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Select className="w-auto" value={k.status} onChange={(e) => update.mutate({ status: e.target.value as platform.TicketStatus })}>
          {platform.TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </Select>
        <Select className="w-auto" value={k.priority} onChange={(e) => update.mutate({ priority: e.target.value as platform.Ticket['priority'] })}>
          {platform.TICKET_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {humanize(p)}
            </option>
          ))}
        </Select>
        {admin && k.assignedAdminId !== admin.id && (
          <Button variant="outline" onClick={() => update.mutate({ assignedAdminId: admin.id })}>
            Assign to me
          </Button>
        )}
      </div>
      <ErrorBox error={update.error} />
      <TicketThread messages={k.messages} mine="platform" />
      <form
        className="mt-4 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) reply.mutate();
        }}
      >
        <ErrorBox error={reply.error} />
        <textarea
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Reply to the hospital…"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note (hidden from hospital)
          </label>
          <Button type="submit" disabled={reply.isPending || !body.trim()}>
            {reply.isPending && <Loader2 className="animate-spin" />} {internal ? 'Add note' : 'Send reply'}
          </Button>
        </div>
      </form>
    </div>
  );
}
