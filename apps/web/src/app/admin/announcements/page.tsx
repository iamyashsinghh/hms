'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platform } from '@hms/shared';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { consoleApi } from '@/modules/platform/console/session';
import { ErrorBox, StatusBadge, dateTime } from '@/modules/platform/ui';

export default function ConsoleAnnouncementsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['console', 'announcements'], queryFn: () => consoleApi.announcements() });
  const [f, setF] = React.useState({ title: '', body: '', severity: 'info' as (typeof platform.ANNOUNCEMENT_SEVERITIES)[number], plans: '' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['console', 'announcements'] });
  const create = useMutation({
    mutationFn: () =>
      consoleApi.createAnnouncement({
        title: f.title,
        body: f.body,
        severity: f.severity,
        planCodes: f.plans.split(',').map((s) => s.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      setF({ title: '', body: '', severity: 'info', plans: '' });
      refresh();
    },
  });
  const toggle = useMutation({ mutationFn: (a: platform.Announcement) => consoleApi.updateAnnouncement(a.id, { isPublished: !a.isPublished }), onSuccess: refresh });
  return (
    <>
      <PageHeader title="Announcements" description="Shown to hospital staff on their platform pages until dismissed." />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>New announcement</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="title">Title</Label>
              <Input id="title" className="mt-1" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="body">Message</Label>
              <textarea
                id="body"
                rows={4}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={f.body}
                onChange={(e) => setF({ ...f, body: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="severity">Severity</Label>
                <Select id="severity" className="mt-1" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value as typeof f.severity })}>
                  {platform.ANNOUNCEMENT_SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="plans">Plans (blank = all)</Label>
                <Input id="plans" className="mt-1" placeholder="starter, growth" value={f.plans} onChange={(e) => setF({ ...f, plans: e.target.value })} />
              </div>
            </div>
            <ErrorBox error={create.error} />
            <Button disabled={create.isPending || f.title.length < 3 || !f.body} onClick={() => create.mutate()}>
              Publish
            </Button>
          </CardContent>
        </Card>
        <div className="space-y-3 lg:col-span-3">
          <ErrorBox error={list.error ?? toggle.error} />
          {list.data?.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex items-start gap-3 pt-6">
                <div className="flex-1">
                  <p className="font-medium">
                    {a.title} <StatusBadge status={a.severity === 'info' ? 'open' : 'urgent'} className="ml-1" />
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{a.body}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {a.planCodes.length ? `Plans: ${a.planCodes.join(', ')}` : 'All plans'} · {dateTime(a.startsAt)}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => toggle.mutate(a)}>
                  {a.isPublished ? 'Unpublish' : 'Publish'}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
