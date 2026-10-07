'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Send } from 'lucide-react';
import { crm as C } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CampSelect, ErrorBox, Field, LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS, Select, Textarea } from '@/modules/crm/ui';

interface Form {
  id?: string;
  name: string;
  channel: C.CampaignChannel;
  message: string;
  statuses: C.LeadStatus[];
  sources: C.LeadSource[];
  campId: string;
}

const CHANNEL_LABELS: Record<C.CampaignChannel, string> = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email' };

export default function CampaignsPage() {
  const canManage = usePermission('crm.campaign.manage');
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<Form | null>(null);
  const [confirming, setConfirming] = React.useState<C.Campaign | null>(null);
  const { data, isPending, error } = useQuery({ queryKey: ['crm', 'campaigns'], queryFn: () => api.crm.campaigns.list(), enabled: canManage });

  const save = useMutation({
    mutationFn: (f: Form) => {
      const body: C.CampaignInput = {
        name: f.name,
        channel: f.channel,
        message: f.message,
        audience: {
          ...(f.statuses.length ? { statuses: f.statuses } : {}),
          ...(f.sources.length ? { sources: f.sources } : {}),
          ...(f.campId ? { campId: f.campId } : {}),
        },
      };
      return f.id ? api.crm.campaigns.update(f.id, body) : api.crm.campaigns.create(body);
    },
    onSuccess: () => {
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ['crm', 'campaigns'] });
    },
  });
  const send = useMutation({
    mutationFn: (id: string) => api.crm.campaigns.send(id),
    onSuccess: () => {
      setConfirming(null);
      queryClient.invalidateQueries({ queryKey: ['crm', 'campaigns'] });
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.crm.campaigns.cancel(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['crm', 'campaigns'] }),
  });

  if (!canManage) return <NoAccess />;

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Send one message to a group of enquiries (by status, source or camp). Messages go through the hospital's messaging settings; opted-out numbers are skipped."
        actions={
          <Button onClick={() => setForm({ name: '', channel: 'sms', message: '', statuses: [], sources: [], campId: '' })}>
            <Plus /> New campaign
          </Button>
        }
      />

      {form && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{form.id ? `Edit ${form.name}` : 'New campaign'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ErrorBox error={save.error ? errorMessage(save.error) : null} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="cg-name" label="Name *" className="sm:col-span-2">
                <Input id="cg-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Free eye check-up week" />
              </Field>
              <Field id="cg-channel" label="Channel">
                <Select id="cg-channel" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value as C.CampaignChannel })}>
                  {C.CAMPAIGN_CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {CHANNEL_LABELS[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="cg-msg" label={`Message * (${form.message.length}/1000)`} className="sm:col-span-3">
                <Textarea id="cg-msg" maxLength={1000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
              </Field>
            </div>
            <div className="space-y-2 text-sm">
              <p className="font-medium">Who gets it</p>
              <div className="flex flex-wrap gap-3">
                <span className="text-muted-foreground">Status (default: open):</span>
                {C.LEAD_STATUSES.map((s) => (
                  <label key={s} className="flex items-center gap-1">
                    <input type="checkbox" checked={form.statuses.includes(s)} onChange={() => setForm({ ...form, statuses: toggle(form.statuses, s) })} /> {LEAD_STATUS_LABELS[s]}
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-3">
                <span className="text-muted-foreground">Source (default: any):</span>
                {C.LEAD_SOURCES.map((s) => (
                  <label key={s} className="flex items-center gap-1">
                    <input type="checkbox" checked={form.sources.includes(s)} onChange={() => setForm({ ...form, sources: toggle(form.sources, s) })} /> {LEAD_SOURCE_LABELS[s]}
                  </label>
                ))}
              </div>
              <Field id="cg-camp" label="Only visitors of camp" className="max-w-sm">
                <CampSelect id="cg-camp" value={form.campId} onChange={(campId) => setForm({ ...form, campId })} />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setForm(null)}>
                Cancel
              </Button>
              <Button disabled={save.isPending || !form.name.trim() || !form.message.trim()} onClick={() => save.mutate(form)}>
                {save.isPending && <Loader2 className="animate-spin" />}
                Save draft
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {confirming && (
        <Card className="mb-6 border-primary/40">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <p className="text-sm">
              Send <strong>{confirming.name}</strong> by {CHANNEL_LABELS[confirming.channel]} to <strong>{confirming.audienceSize}</strong> enquiries now? This uses message credits and cannot be undone.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setConfirming(null)}>
                No
              </Button>
              <Button disabled={send.isPending} onClick={() => send.mutate(confirming.id)}>
                {send.isPending ? <Loader2 className="animate-spin" /> : <Send />} Send now
              </Button>
            </div>
            <ErrorBox error={send.error ? errorMessage(send.error) : null} />
          </CardContent>
        </Card>
      )}

      <Card>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Campaign</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Audience</TableHead>
                <TableHead className="text-right">Sent / skipped</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No campaigns yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="max-w-80">
                      <div className="font-medium">{c.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{c.message}</div>
                    </TableCell>
                    <TableCell>{CHANNEL_LABELS[c.channel]}</TableCell>
                    <TableCell>
                      <Badge variant={c.status === 'sent' ? 'accent' : c.status === 'cancelled' ? 'secondary' : 'default'}>{c.status}</Badge>
                      {c.sentAt && <div className="text-xs text-muted-foreground">{formatDate(c.sentAt)}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.audienceSize}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.status === 'sent' ? `${c.queuedCount} / ${c.skippedCount}` : '—'}</TableCell>
                    <TableCell className="text-right">
                      {c.status === 'draft' && (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setForm({
                                id: c.id,
                                name: c.name,
                                channel: c.channel,
                                message: c.message,
                                statuses: c.audience.statuses ?? [],
                                sources: c.audience.sources ?? [],
                                campId: c.audience.campId ?? '',
                              })
                            }
                          >
                            Edit
                          </Button>
                          <Button variant="ghost" size="sm" disabled={cancel.isPending} onClick={() => cancel.mutate(c.id)}>
                            Cancel
                          </Button>
                          <Button size="sm" disabled={!c.audienceSize} onClick={() => setConfirming(c)}>
                            <Send /> Send
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
