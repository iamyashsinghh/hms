'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platform } from '@hms/shared';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { firstError, validate } from '@/lib/validate';
import { consoleApi } from '@/modules/platform/console/session';
import { ErrorBox, StatusBadge, dateTime } from '@/modules/platform/ui';

export default function ConsoleAnnouncementsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['console', 'announcements'], queryFn: () => consoleApi.announcements() });
  const blank = { title: '', body: '', severity: 'info' as (typeof platform.ANNOUNCEMENT_SEVERITIES)[number], plans: '', startsAt: '', endsAt: '' };
  const [f, setF] = React.useState(blank);
  const [formError, setFormError] = React.useState<string | null>(null);
  /** datetime-local value (browser time) to ISO; invalid text stays as is so validation reports it. */
  const toIso = (v: string) => {
    if (!v) return undefined;
    const t = new Date(v);
    return Number.isNaN(t.getTime()) ? v : t.toISOString();
  };
  const body = (): platform.UpsertAnnouncement => ({
    title: f.title,
    body: f.body,
    severity: f.severity,
    planCodes: f.plans.split(',').map((s) => s.trim()).filter(Boolean),
    startsAt: toIso(f.startsAt),
    endsAt: toIso(f.endsAt) ?? null,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['console', 'announcements'] });
  const create = useMutation({
    mutationFn: () => consoleApi.createAnnouncement(body()),
    onSuccess: () => {
      setF(blank);
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
              <Input id="title" className="mt-1" maxLength={150} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="body">Message</Label>
              <textarea
                id="body"
                rows={4}
                maxLength={5000}
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="startsAt">Show from (blank = now)</Label>
                <Input id="startsAt" type="datetime-local" className="mt-1" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="endsAt">Show until (blank = no end)</Label>
                <Input id="endsAt" type="datetime-local" className="mt-1" min={f.startsAt || undefined} value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />
              </div>
            </div>
            <ErrorBox error={formError ? new Error(formError) : create.error} />
            <Button
              disabled={create.isPending}
              onClick={() => {
                const v = validate(platform.upsertAnnouncementSchema, body());
                const message = firstError(v.errors);
                setFormError(message);
                if (!message) create.mutate();
              }}
            >
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
