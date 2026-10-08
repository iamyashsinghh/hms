'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Send } from 'lucide-react';
import { notifications as n, type Patient } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { firstError, validate } from '@/lib/validate';
import { usePermission } from '@/lib/auth';
import { fullName } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CHANNEL_LABELS, Checkbox, ErrorBox, REASON_LABELS, StatusBadge, Textarea } from '@/modules/notifications/ui';

export default function SendMessagePage() {
  const canSend = usePermission('notifications.message.send');
  const canSearchPatients = usePermission('core.patient.read');
  const queryClient = useQueryClient();

  const [mode, setMode] = React.useState<'patient' | 'mobile'>(canSearchPatients ? 'patient' : 'mobile');
  const [search, setSearch] = React.useState('');
  const [patient, setPatient] = React.useState<Patient | null>(null);
  const [mobile, setMobile] = React.useState('');
  const [template, setTemplate] = React.useState('custom.message');
  const [message, setMessage] = React.useState('');
  const [vars, setVars] = React.useState<Record<string, string>>({});
  const [channels, setChannels] = React.useState<n.Channel[]>(['sms']);
  const [formError, setFormError] = React.useState<string | null>(null);

  const patients = useQuery({
    queryKey: ['patients', { q: search.trim(), pageSize: 5 }],
    queryFn: () => api.patients.list({ q: search.trim(), pageSize: 5 }),
    enabled: canSearchPatients && mode === 'patient' && search.trim().length >= 2 && !patient,
  });

  const send = useMutation({
    mutationFn: (body: n.SendRequest) => api.notifications.send(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  if (!canSend) return <NoAccess />;

  const def = n.DEFAULT_TEMPLATES.find((t) => t.key === template)!;
  const extraVars = def.variables.filter((v) => v !== 'hospitalName' && v !== 'patientName' && v !== 'message');
  const availableChannels = n.CHANNELS.filter((c) => def.channels[c]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const to = mode === 'patient' ? { patientId: patient?.id } : { mobile: mobile.trim() };
    const data: Record<string, string> = { ...vars };
    if (template === 'custom.message') data.message = message;
    if (mode === 'patient' && !patient) return setFormError('Pick a patient');
    if (mode === 'mobile' && !mobile.trim()) return setFormError('Enter a 10-digit Indian mobile number');
    if (template === 'custom.message' && !message.trim()) return setFormError('Type the message to send');
    const body: n.SendRequest = { to, template, data, channels: channels.filter((c) => availableChannels.includes(c)) };
    const v = validate(n.sendRequestSchema, body);
    setFormError(firstError(v.errors));
    if (v.data) send.mutate(body);
  };

  const toggle = (c: n.Channel) => setChannels((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  return (
    <div className="max-w-3xl">
      <Link href="/notifications" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> Messages
      </Link>
      <PageHeader title="Send message" description="Send an SMS, WhatsApp, email or push to a patient. Opted-out numbers are skipped automatically." />

      <form onSubmit={submit} className="space-y-6">
        {(formError || send.error) && <ErrorBox>{formError ?? errorMessage(send.error)}</ErrorBox>}
        {send.data && (
          <Card className="border-accent/40">
            <CardContent className="space-y-2 p-4 text-sm">
              {send.data.messages.map((m) => (
                <div key={m.id} className="flex items-center gap-2">
                  <span className="w-20 font-medium">{CHANNEL_LABELS[m.channel]}</span>
                  <StatusBadge status={m.status} />
                  {m.reason && <span className="text-muted-foreground">{REASON_LABELS[m.reason] ?? m.reason}</span>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>To</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4 text-sm">
              {canSearchPatients && (
                <label className="inline-flex items-center gap-2">
                  <input type="radio" checked={mode === 'patient'} onChange={() => setMode('patient')} /> Patient
                </label>
              )}
              <label className="inline-flex items-center gap-2">
                <input type="radio" checked={mode === 'mobile'} onChange={() => setMode('mobile')} /> Mobile number
              </label>
            </div>
            {mode === 'patient' ? (
              patient ? (
                <div className="flex items-center justify-between rounded-md border p-3 text-sm">
                  <div>
                    <p className="font-medium">{fullName(patient)}</p>
                    <p className="text-muted-foreground">
                      {patient.uhid} · {patient.mobile ?? 'no mobile'} · {patient.email ?? 'no email'}
                    </p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPatient(null)}>
                    Change
                  </Button>
                </div>
              ) : (
                <div>
                  <Input placeholder="Search by name, UHID or mobile…" value={search} onChange={(e) => setSearch(e.target.value)} />
                  {patients.data && (
                    <ul className="mt-2 divide-y rounded-md border text-sm">
                      {patients.data.items.length === 0 && <li className="p-3 text-muted-foreground">No patients found.</li>}
                      {patients.data.items.map((p) => (
                        <li key={p.id}>
                          <button type="button" className="w-full p-3 text-left hover:bg-muted" onClick={() => setPatient(p)}>
                            <span className="font-medium">{fullName(p)}</span> <span className="text-muted-foreground">· {p.uhid} · {p.mobile ?? '—'}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            ) : (
              <div>
                <Label htmlFor="mobile">Mobile number</Label>
                <Input id="mobile" className="mt-2 max-w-xs" type="tel" inputMode="numeric" placeholder="10-digit mobile" maxLength={14} value={mobile} onChange={(e) => setMobile(e.target.value)} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Message</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="template">Template</Label>
              <Select id="template" className="mt-2" value={template} onChange={(e) => setTemplate(e.target.value)}>
                {n.DEFAULT_TEMPLATES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
            {template === 'custom.message' && (
              <div>
                <Label htmlFor="message">Message</Label>
                <Textarea id="message" className="mt-2" maxLength={600} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Type your message" />
                <p className="mt-1 text-xs text-muted-foreground">{message.length} characters. The hospital name is added at the end.</p>
              </div>
            )}
            {extraVars.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                {extraVars.map((v) => (
                  <div key={v}>
                    <Label htmlFor={`var-${v}`}>{v}</Label>
                    <Input id={`var-${v}`} className="mt-2" value={vars[v] ?? ''} maxLength={1000} onChange={(e) => setVars({ ...vars, [v]: e.target.value })} />
                  </div>
                ))}
              </div>
            )}
            <div>
              <Label>Channels</Label>
              <div className="mt-2 flex flex-wrap gap-4">
                {availableChannels.map((c) => (
                  <Checkbox key={c} label={CHANNEL_LABELS[c]} checked={channels.includes(c)} onChange={() => toggle(c)} />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Link href="/notifications" className={buttonVariants({ variant: 'outline' })}>
            Cancel
          </Link>
          <Button type="submit" disabled={send.isPending || (mode === 'patient' && !patient) || !channels.some((c) => availableChannels.includes(c))}>
            {send.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}
