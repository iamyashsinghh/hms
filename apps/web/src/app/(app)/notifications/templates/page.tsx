'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import type { notifications as n } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChannelBadge } from '@/modules/notifications/ui';

export default function TemplatesPage() {
  const canRead = usePermission('notifications.template.read');
  const canManage = usePermission('notifications.template.manage');
  const { data, isPending, error } = useQuery({ queryKey: ['notifications', 'templates'], queryFn: () => api.notifications.templates(), enabled: canRead });

  if (!canRead) return <NoAccess />;

  const groups = new Map<string, n.Template[]>();
  for (const t of data ?? []) groups.set(t.key, [...(groups.get(t.key) ?? []), t]);

  return (
    <>
      <PageHeader title="Message templates" description="The text patients receive. Use {{variables}}; SMS templates need a DLT template id before going live." />
      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{errorMessage(error)}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {[...groups.values()].map((list) => (
            <Card key={list[0]!.key}>
              <CardHeader>
                <CardTitle>{list[0]!.name}</CardTitle>
                <p className="font-mono text-xs text-muted-foreground">{list[0]!.key}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {list.map((t) => (
                  <div key={t.channel} className="flex items-start gap-3 rounded-md border p-3">
                    <div className="w-20 shrink-0 pt-0.5">
                      <ChannelBadge channel={t.channel} />
                    </div>
                    <div className="min-w-0 flex-1 text-sm">
                      {t.subject && <p className="font-medium">{t.subject}</p>}
                      <p className="line-clamp-3 whitespace-pre-wrap text-muted-foreground">{t.body}</p>
                      <div className="mt-1 flex gap-1.5">
                        {t.isCustom && <Badge variant="secondary">Edited</Badge>}
                        {!t.isActive && <Badge variant="destructive">Off</Badge>}
                        {t.channel === 'sms' && !t.dltTemplateId && <Badge variant="outline">No DLT id</Badge>}
                      </div>
                    </div>
                    {canManage && (
                      <Link href={`/notifications/templates/${t.key}/${t.channel}`} className={buttonVariants({ variant: 'ghost', size: 'icon' })} aria-label={`Edit ${t.name} ${t.channel}`}>
                        <Pencil />
                      </Link>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
