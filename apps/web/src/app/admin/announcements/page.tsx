'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { platform } from '@hms/shared';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { consoleApi } from '@/modules/platform/console/session';
import { ErrorBox, StatusBadge, dateTime, firstIssue } from '@/modules/platform/ui';

type Severity = (typeof platform.ANNOUNCEMENT_SEVERITIES)[number];

/** ISO timestamp -> value for <input type="datetime-local"> in local time. */
const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

const LABELS: Record<string, string> = { title: 'Title', body: 'Message', startsAt: 'Starts', endsAt: 'Ends', planCodes: 'Plans' };

/** New announcement; with `initial` it edits that one (text, audience, schedule). */
function AnnouncementForm({ initial, onDone }: { initial?: platform.Announcement; onDone: () => void }) {
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ['console', 'plans'], queryFn: () => consoleApi.plans() });
  const blank = () => ({
    title: initial?.title ?? '',
    body: initial?.body ?? '',
    severity: initial?.severity ?? ('info' as Severity),
    planCodes: initial?.planCodes ?? ([] as string[]),
    startsAt: toLocalInput(initial?.startsAt),
    endsAt: toLocalInput(initial?.endsAt),
    isPublished: initial?.isPublished ?? true,
  });
  const [f, setF] = React.useState(blank);
  const save = useMutation({
    mutationFn: () => {
      const startsAt = fromLocalInput(f.startsAt);
      const endsAt = fromLocalInput(f.endsAt);
      const body = {
        title: f.title,
        body: f.body,
        severity: f.severity,
        planCodes: f.planCodes,
        ...(startsAt ? { startsAt } : {}),
        // On edit an emptied end date removes the end; on create it is simply left out.
        ...(endsAt || initial ? { endsAt } : {}),
        isPublished: f.isPublished,
      };
      const problem = firstIssue(initial ? platform.updateAnnouncementSchema : platform.upsertAnnouncementSchema, body, LABELS);
      if (problem) throw new Error(problem);
      const start = new Date(startsAt ?? initial?.startsAt ?? Date.now()).getTime();
      if (endsAt && new Date(endsAt).getTime() <= start) throw new Error('Ends: must be after the start');
      return initial ? consoleApi.updateAnnouncement(initial.id, body) : consoleApi.createAnnouncement(body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['console', 'announcements'] });
      if (!initial) setF(blank());
      onDone();
    },
  });
  const id = (k: string) => `${initial?.id ?? 'new'}-${k}`;
  const togglePlan = (code: string) => setF((x) => ({ ...x, planCodes: x.planCodes.includes(code) ? x.planCodes.filter((c) => c !== code) : [...x.planCodes, code] }));
  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor={id('title')}>Title *</Label>
        <Input id={id('title')} className="mt-1" maxLength={150} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </div>
      <div>
        <Label htmlFor={id('body')}>Message *</Label>
        <textarea
          id={id('body')}
          rows={4}
          maxLength={5000}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={f.body}
          onChange={(e) => setF({ ...f, body: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={id('severity')}>Severity</Label>
          <Select id={id('severity')} className="mt-1" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value as Severity })}>
            {platform.ANNOUNCEMENT_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={f.isPublished} onChange={(e) => setF({ ...f, isPublished: e.target.checked })} /> Published
        </label>
        <div>
          <Label htmlFor={id('starts')}>Starts (blank = now)</Label>
          <Input id={id('starts')} type="datetime-local" className="mt-1" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} />
        </div>
        <div>
          <Label htmlFor={id('ends')}>Ends (blank = no end)</Label>
          <Input id={id('ends')} type="datetime-local" className="mt-1" min={f.startsAt || undefined} value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />
        </div>
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Plans (none ticked = every plan)</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {plans.data?.map((p) => (
            <label key={p.code} className="flex items-center gap-2">
              <input type="checkbox" checked={f.planCodes.includes(p.code)} onChange={() => togglePlan(p.code)} /> {p.name}
            </label>
          ))}
        </div>
      </fieldset>
      <ErrorBox error={save.error} />
      <div className="flex gap-2">
        <Button disabled={save.isPending || f.title.trim().length < 3 || !f.body.trim()} onClick={() => save.mutate()}>
          {initial ? 'Save changes' : 'Publish'}
        </Button>
        {initial && (
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

export default function ConsoleAnnouncementsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['console', 'announcements'], queryFn: () => consoleApi.announcements() });
  const [editing, setEditing] = React.useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['console', 'announcements'] });
  const toggle = useMutation({ mutationFn: (a: platform.Announcement) => consoleApi.updateAnnouncement(a.id, { isPublished: !a.isPublished }), onSuccess: refresh });
  return (
    <>
      <PageHeader title="Announcements" description="Shown to hospital staff on their platform pages until dismissed or until the end date." />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="h-fit lg:col-span-2">
          <CardHeader>
            <CardTitle>New announcement</CardTitle>
          </CardHeader>
          <CardContent>
            <AnnouncementForm onDone={() => undefined} />
          </CardContent>
        </Card>
        <div className="space-y-3 lg:col-span-3">
          <ErrorBox error={list.error ?? toggle.error} />
          {list.data?.map((a) =>
            editing === a.id ? (
              <Card key={a.id}>
                <CardHeader>
                  <CardTitle>Edit announcement</CardTitle>
                </CardHeader>
                <CardContent>
                  <AnnouncementForm initial={a} onDone={() => setEditing(null)} />
                </CardContent>
              </Card>
            ) : (
              <Card key={a.id}>
                <CardContent className="flex items-start gap-3 pt-6">
                  <div className="flex-1">
                    <p className="font-medium">
                      {a.title} <StatusBadge status={a.severity === 'info' ? 'open' : 'urgent'} className="ml-1" />
                      {!a.isPublished && <span className="ml-2 text-xs text-muted-foreground">unpublished</span>}
                    </p>
                    <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{a.body}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {a.planCodes.length ? `Plans: ${a.planCodes.join(', ')}` : 'All plans'} · {dateTime(a.startsAt)}
                      {a.endsAt ? ` → ${dateTime(a.endsAt)}` : ' · no end date'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" aria-label={`Edit ${a.title}`} onClick={() => setEditing(a.id)}>
                      <Pencil />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => toggle.mutate(a)}>
                      {a.isPublished ? 'Unpublish' : 'Publish'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ),
          )}
        </div>
      </div>
    </>
  );
}
