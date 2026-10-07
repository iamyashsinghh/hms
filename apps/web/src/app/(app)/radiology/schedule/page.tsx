'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { OrderStatusBadge, PriorityBadge, timeOnly, todayIso } from '@/modules/radiology/ui';

export default function RadiologySchedulePage() {
  const canRead = usePermission('radiology.order.read');
  const [date, setDate] = React.useState(todayIso);
  const modalities = useQuery({ queryKey: ['radiology', 'modalities'], queryFn: () => api.radiology.modalities(), enabled: canRead });
  const schedule = useQuery({ queryKey: ['radiology', 'schedule', date], queryFn: () => api.radiology.scheduleFor({ date }), enabled: canRead && !!date, refetchInterval: 30_000 });

  if (!canRead) return <NoAccess />;
  const error = modalities.error ?? schedule.error;

  return (
    <>
      <PageHeader
        title="Scan schedule"
        description="Booked slots per machine for the day. Book or move a slot from the order page."
        actions={<Input type="date" className="w-44" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Day" />}
      />
      {error && <p className="text-sm text-destructive">{errorMessage(error)}</p>}
      {modalities.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No machines yet. Add them in <Link href="/radiology/masters" className="underline">Radiology masters</Link>.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {modalities.data?.map((m) => {
          const slots = schedule.data?.filter((s) => s.modalityId === m.id) ?? [];
          return (
            <Card key={m.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  {m.name} {m.room && <span className="text-sm font-normal text-muted-foreground">· {m.room}</span>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {slots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{schedule.isPending ? 'Loading…' : 'Free all day.'}</p>
                ) : (
                  <ul className="divide-y text-sm">
                    {slots.map((s) => (
                      <li key={s.orderId} className="flex items-start justify-between gap-3 py-2">
                        <div>
                          <div className="font-mono text-xs text-muted-foreground">
                            {timeOnly(s.scheduledAt)}–{timeOnly(s.scheduledEnd)}
                          </div>
                          <Link href={`/radiology/orders/${s.orderId}`} className="font-medium hover:underline">
                            {s.patientName}
                          </Link>
                          <div className="text-xs text-muted-foreground">
                            {s.studyName} · {s.uhid}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <OrderStatusBadge status={s.status} />
                          <PriorityBadge priority={s.priority} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
