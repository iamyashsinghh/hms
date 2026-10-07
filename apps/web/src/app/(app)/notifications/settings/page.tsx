'use client';

import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { notifications as n } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CHANNEL_LABELS, Checkbox, ErrorBox, formatDateTime, rupees } from '@/modules/notifications/ui';

const ENTRY_LABELS: Record<n.LedgerEntryType, string> = { grant: 'Free credits', topup: 'Top-up', debit: 'Message', refund: 'Refund', adjustment: 'Adjustment' };

function SettingsForm() {
  const { data, error } = useQuery({ queryKey: ['notifications', 'settings'], queryFn: () => api.notifications.settings() });
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return <SettingsEditor initial={data} />;
}

function SettingsEditor({ initial }: { initial: n.Settings }) {
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<n.Settings>(initial);
  const save = useMutation({
    mutationFn: (body: n.UpdateSettings) => api.notifications.updateSettings(body),
    onSuccess: (s) => {
      setForm(s);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const toggle = (list: n.Channel[], c: n.Channel) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({
              ...form,
              displayName: form.displayName || null,
              smsSenderId: form.smsSenderId ? form.smsSenderId.toUpperCase() : null,
              emailFromName: form.emailFromName || null,
              emailReplyTo: form.emailReplyTo || null,
            });
          }}
        >
          {save.error && <ErrorBox>{errorMessage(save.error)}</ErrorBox>}
          {save.isSuccess && <p className="text-sm text-accent-foreground">Saved.</p>}
          <div>
            <Label>Channels switched on</Label>
            <div className="mt-2 flex flex-wrap gap-4">
              {n.CHANNELS.map((c) => (
                <Checkbox key={c} label={CHANNEL_LABELS[c]} checked={form.enabledChannels.includes(c)} onChange={() => setForm({ ...form, enabledChannels: toggle(form.enabledChannels, c) })} />
              ))}
            </div>
          </div>
          <div>
            <Label>Default channels for manual messages</Label>
            <div className="mt-2 flex flex-wrap gap-4">
              {n.CHANNELS.map((c) => (
                <Checkbox key={c} label={CHANNEL_LABELS[c]} checked={form.defaultChannels.includes(c)} onChange={() => setForm({ ...form, defaultChannels: toggle(form.defaultChannels, c) })} />
              ))}
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label htmlFor="displayName">Hospital name in messages</Label>
              <Input id="displayName" className="mt-2" placeholder="Registered name" value={form.displayName ?? ''} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="sender">SMS sender id (DLT header)</Label>
              <Input id="sender" className="mt-2 uppercase" maxLength={6} placeholder="e.g. HMSHSP" value={form.smsSenderId ?? ''} onChange={(e) => setForm({ ...form, smsSenderId: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="fromName">Email from name</Label>
              <Input id="fromName" className="mt-2" value={form.emailFromName ?? ''} onChange={(e) => setForm({ ...form, emailFromName: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="replyTo">Email reply-to</Label>
              <Input id="replyTo" type="email" className="mt-2" value={form.emailReplyTo ?? ''} onChange={(e) => setForm({ ...form, emailReplyTo: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="threshold">Low balance alert below (₹)</Label>
              <Input id="threshold" type="number" min={0} className="mt-2" value={form.lowBalanceThreshold} onChange={(e) => setForm({ ...form, lowBalanceThreshold: Number(e.target.value) })} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              Save settings
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function CreditsSettingsPage() {
  const canRead = usePermission('notifications.credit.read');
  const canSettings = usePermission('notifications.settings.manage');
  const [page, setPage] = React.useState(1);
  const credits = useQuery({ queryKey: ['notifications', 'credits'], queryFn: () => api.notifications.credits(), enabled: canRead });
  const ledger = useQuery({
    queryKey: ['notifications', 'ledger', page],
    queryFn: () => api.notifications.ledger({ page, pageSize: 20 }),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });

  if (!canRead) return <NoAccess />;
  const pages = ledger.data ? Math.max(1, Math.ceil(ledger.data.total / ledger.data.pageSize)) : 1;

  return (
    <>
      <PageHeader title="Credits & settings" description="Prepaid message credits (1 credit = ₹1) and how the hospital sends messages." />
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Balance</p>
            <p className={`mt-1 text-3xl font-semibold ${credits.data?.low ? 'text-destructive' : ''}`}>{credits.data ? rupees(credits.data.balance) : '—'}</p>
            {credits.data?.low && <Badge variant="destructive" className="mt-2">Low balance: contact support to top up</Badge>}
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardContent className="p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rates</p>
            <div className="mt-2 flex flex-wrap gap-6 text-sm">
              {credits.data &&
                n.CHANNELS.map((c) => (
                  <div key={c}>
                    <p className="text-muted-foreground">{CHANNEL_LABELS[c]}</p>
                    <p className="font-medium">
                      {credits.data.rates[c] ? rupees(credits.data.rates[c]) : 'Free'}
                      {c === 'sms' && credits.data.rates[c] ? ' / 160 chars' : ''}
                    </p>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {canSettings && <SettingsForm />}
        <Card className={canSettings ? '' : 'xl:col-span-2'}>
          <CardHeader>
            <CardTitle>Credit history</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Time</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.data?.items.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(e.createdAt)}</TableCell>
                  <TableCell>
                    {ENTRY_LABELS[e.entryType]}
                    {e.channel && <span className="text-muted-foreground"> · {CHANNEL_LABELS[e.channel]}</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{e.note ?? '—'}</TableCell>
                  <TableCell className={`text-right tabular-nums ${e.amount < 0 ? '' : 'text-accent-foreground'}`}>
                    {e.amount > 0 ? '+' : ''}
                    {rupees(e.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {ledger.data && ledger.data.total > ledger.data.pageSize && (
            <div className="flex items-center justify-end gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft />
              </Button>
              <span>
                {page} / {pages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight />
              </Button>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
