'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { notifications as n } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CHANNEL_LABELS, Checkbox } from '@/modules/notifications/ui';

export default function RulesPage() {
  const canRead = usePermission('notifications.template.read');
  const canManage = usePermission('notifications.template.manage');
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({ queryKey: ['notifications', 'rules'], queryFn: () => api.notifications.rules(), enabled: canRead });
  const templates = useQuery({ queryKey: ['notifications', 'templates'], queryFn: () => api.notifications.templates(), enabled: canRead });
  const update = useMutation({
    mutationFn: (body: n.UpdateRule) => api.notifications.updateRule(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications', 'rules'] }),
  });

  if (!canRead) return <NoAccess />;

  const hasTemplate = (key: string, c: n.Channel) => templates.data?.some((t) => t.key === key && t.channel === c && t.isActive) ?? true;

  return (
    <>
      <PageHeader title="Automatic messages" description="Messages sent automatically to patients, doctors and staff when something happens in the hospital." />
      {update.error && <p className="mb-4 text-sm text-destructive">{errorMessage(update.error)}</p>}
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>When</TableHead>
              <TableHead>To</TableHead>
              <TableHead>On</TableHead>
              <TableHead>Send by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={4} className="text-destructive">
                  {errorMessage(error)}
                </TableCell>
              </TableRow>
            ) : (
              data.map((r) => (
                <TableRow key={r.eventTopic}>
                  <TableCell>
                    <p className="font-medium">{r.eventName}</p>
                    <p className="font-mono text-xs text-muted-foreground">{r.templateKey}</p>
                  </TableCell>
                  <TableCell>{n.RECIPIENT_LABELS[r.recipient]}</TableCell>
                  <TableCell>
                    <Checkbox
                      label={r.isActive ? 'On' : 'Off'}
                      checked={r.isActive}
                      disabled={!canManage || update.isPending}
                      onChange={(e) => update.mutate({ eventTopic: r.eventTopic, channels: r.channels.length ? r.channels : ['sms'], isActive: e.target.checked })}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-4">
                      {n.CHANNELS.filter((c) => hasTemplate(r.templateKey, c)).map((c) => (
                        <Checkbox
                          key={c}
                          label={CHANNEL_LABELS[c]}
                          checked={r.channels.includes(c)}
                          disabled={!canManage || update.isPending}
                          onChange={(e) =>
                            update.mutate({
                              eventTopic: r.eventTopic,
                              channels: e.target.checked ? [...r.channels, c] : r.channels.filter((x) => x !== c),
                              isActive: r.isActive,
                            })
                          }
                        />
                      ))}
                      {update.isPending && update.variables?.eventTopic === r.eventTopic && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
