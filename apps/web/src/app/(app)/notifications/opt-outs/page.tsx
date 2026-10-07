'use client';

import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { notifications as n } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CHANNEL_LABELS, ChannelBadge, ErrorBox } from '@/modules/notifications/ui';

export default function OptOutsPage() {
  const canManage = usePermission('notifications.optout.manage');
  const queryClient = useQueryClient();
  const [q, setQ] = React.useState('');
  const [channel, setChannel] = React.useState<n.CreateOptOut['channel']>('all');
  const [address, setAddress] = React.useState('');
  const [reason, setReason] = React.useState('');

  const list = useQuery({
    queryKey: ['notifications', 'opt-outs', q],
    queryFn: () => api.notifications.optOuts({ q: q.trim() || undefined, pageSize: 100 }),
    placeholderData: keepPreviousData,
    enabled: canManage,
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notifications', 'opt-outs'] });
  const add = useMutation({
    mutationFn: () => api.notifications.addOptOut({ channel, address, reason: reason || undefined }),
    onSuccess: () => {
      setAddress('');
      setReason('');
      invalidate();
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.notifications.removeOptOut(id), onSuccess: invalidate });

  if (!canManage) return <NoAccess />;

  return (
    <>
      <PageHeader title="Opt-outs" description="Numbers and emails that must not receive messages. Clinical messages are skipped too." />
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Add to do-not-contact list</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <Select aria-label="Channel" className="w-40" value={channel} onChange={(e) => setChannel(e.target.value as n.CreateOptOut['channel'])}>
              {(['all', ...n.CHANNELS] as const).map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABELS[c]}
                </option>
              ))}
            </Select>
            <Input aria-label="Mobile or email" className="w-60" placeholder="Mobile or email" value={address} onChange={(e) => setAddress(e.target.value)} />
            <Input aria-label="Reason" className="w-60" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button type="submit" disabled={add.isPending || address.trim().length < 3}>
              {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Add
            </Button>
          </form>
          {add.error && (
            <div className="mt-3">
              <ErrorBox>{errorMessage(add.error)}</ErrorBox>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <div className="border-b p-4">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" className="pl-9" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Address</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Added</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isPending ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : list.data?.items.length ? (
              list.data.items.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono text-xs">{o.address}</TableCell>
                  <TableCell>
                    <ChannelBadge channel={o.channel} />
                  </TableCell>
                  <TableCell>{o.reason ?? '—'}</TableCell>
                  <TableCell>{formatDate(o.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" aria-label={`Remove ${o.address}`} disabled={remove.isPending} onClick={() => remove.mutate(o.id)}>
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  Nobody has opted out.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
