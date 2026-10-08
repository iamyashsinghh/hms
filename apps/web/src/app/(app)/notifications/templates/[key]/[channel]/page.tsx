'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, RotateCcw } from 'lucide-react';
import { notifications as n } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { firstError, validate } from '@/lib/validate';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CHANNEL_LABELS, Checkbox, ErrorBox, Textarea, rupees } from '@/modules/notifications/ui';

const SAMPLE: Record<string, string> = { uhid: 'UH000123', date: '08 Oct 2026', time: '10:30 AM', tokenNo: '12', amount: '500.00', mode: 'UPI', message: 'Your report is ready.', doctorName: 'Dr. Rao' };

export default function EditTemplatePage({ params }: { params: Promise<{ key: string; channel: string }> }) {
  const { key, channel: ch } = use(params);
  const channel = ch as n.Channel;
  const canManage = usePermission('notifications.template.manage');
  const templates = useQuery({ queryKey: ['notifications', 'templates'], queryFn: () => api.notifications.templates(), enabled: canManage });
  const current = templates.data?.find((t) => t.key === key && t.channel === channel);

  if (!canManage) return <NoAccess />;
  if (templates.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!current || !n.CHANNELS.includes(channel)) return <p className="text-sm text-destructive">Template not found.</p>;
  return <TemplateEditor key={`${key}/${channel}`} template={current} />;
}

type Form = { subject: string; body: string; dltTemplateId: string; providerTemplateName: string; isActive: boolean };

function TemplateEditor({ template: current }: { template: n.Template }) {
  const { key, channel } = current;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<Form>({
    subject: current.subject ?? '',
    body: current.body,
    dltTemplateId: current.dltTemplateId ?? '',
    providerTemplateName: current.providerTemplateName ?? '',
    isActive: current.isActive,
  });
  const [debounced, setDebounced] = React.useState(form);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(form), 300);
    return () => clearTimeout(t);
  }, [form]);
  const preview = useQuery({
    queryKey: ['notifications', 'preview', channel, debounced.subject, debounced.body],
    queryFn: () => api.notifications.previewTemplate({ channel, subject: debounced.subject || null, body: debounced.body, data: SAMPLE }),
    enabled: !!debounced.body,
  });

  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications', 'templates'] });
    router.push('/notifications/templates');
  };
  const [formError, setFormError] = React.useState<string | null>(null);
  const body = (): n.UpsertTemplate => ({
    subject: form.subject || null,
    body: form.body,
    dltTemplateId: form.dltTemplateId || null,
    providerTemplateName: form.providerTemplateName || null,
    isActive: form.isActive,
  });
  const save = useMutation({
    mutationFn: () => api.notifications.saveTemplate(key, channel, body()),
    onSuccess: done,
  });
  const reset = useMutation({ mutationFn: () => api.notifications.resetTemplate(key, channel), onSuccess: done });


  const hasSubject = channel === 'email' || channel === 'push';
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="max-w-4xl">
      <Link href="/notifications/templates" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> Templates
      </Link>
      <PageHeader title={`${current.name} · ${CHANNEL_LABELS[channel]}`} description={`Variables: ${current.variables.map((v) => `{{${v}}}`).join(' ')}`} />
      {(
        <form
          className="grid gap-6 lg:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            const v = validate(n.upsertTemplateSchema, body());
            setFormError(firstError(v.errors));
            if (v.data) save.mutate();
          }}
        >
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Text</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {(formError || save.error || reset.error) && <ErrorBox>{formError ?? errorMessage(save.error ?? reset.error)}</ErrorBox>}
              {hasSubject && (
                <div>
                  <Label htmlFor="subject">{channel === 'email' ? 'Subject' : 'Title'}</Label>
                  <Input id="subject" className="mt-2" value={form.subject} maxLength={200} onChange={(e) => set({ subject: e.target.value })} />
                </div>
              )}
              <div>
                <Label htmlFor="body">Body</Label>
                <Textarea id="body" className="mt-2 min-h-40" value={form.body} maxLength={2000} onChange={(e) => set({ body: e.target.value })} />
              </div>
              {channel === 'sms' && (
                <div>
                  <Label htmlFor="dlt">DLT / MSG91 template id</Label>
                  <Input id="dlt" className="mt-2" value={form.dltTemplateId} maxLength={50} onChange={(e) => set({ dltTemplateId: e.target.value })} placeholder="Required by TRAI for SMS in India" />
                </div>
              )}
              {channel === 'whatsapp' && (
                <div>
                  <Label htmlFor="wa">Approved WhatsApp template id</Label>
                  <Input id="wa" className="mt-2" value={form.providerTemplateName} maxLength={100} onChange={(e) => set({ providerTemplateName: e.target.value })} />
                </div>
              )}
              <Checkbox label="Template is on" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Preview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {preview.data ? (
                <>
                  <div className="rounded-lg bg-muted p-3">
                    {preview.data.subject && <p className="font-medium">{preview.data.subject}</p>}
                    <p className="whitespace-pre-wrap">{preview.data.body}</p>
                  </div>
                  <p className="text-muted-foreground">
                    {channel === 'sms' && `${preview.data.parts} SMS part${preview.data.parts > 1 ? 's' : ''} · `}
                    {rupees(preview.data.cost)} per message
                  </p>
                  {preview.data.missingVariables.length > 0 && <p className="text-destructive">Unknown variables: {preview.data.missingVariables.join(', ')}</p>}
                </>
              ) : (
                <p className="text-muted-foreground">Type to see a preview.</p>
              )}
            </CardContent>
          </Card>
          <div className="flex justify-between gap-2 lg:col-span-5">
            {current.isCustom ? (
              <Button type="button" variant="outline" disabled={reset.isPending} onClick={() => reset.mutate()}>
                <RotateCcw /> Reset to default
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={save.isPending || !form.body.trim()}>
              {save.isPending && <Loader2 className="animate-spin" />}
              Save template
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
