'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CodeXml, CreditCard, FileLock, FingerprintPattern, Loader2, Microscope, QrCode } from 'lucide-react';
import { integrations as I } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { CopyBox, ErrorBox, Field, Notice, formatDateTime } from '@/modules/integrations/ui';

const ABDM_MODE_HELP: Record<I.AbdmMode, string> = {
  disabled: 'ABDM screens are switched off. No ABHA, Scan-and-Share or consent features.',
  mock: 'Built-in simulator. Nothing leaves this server; every OTP is 123456. Good for training and demos.',
  sandbox: 'ABDM sandbox gateway. Needs the ABDM client id and secret set on the server.',
};
const PAYMENT_HELP: Record<I.PaymentProvider, string> = {
  none: 'No online payment links.',
  mock: 'Built-in simulator. Links can be marked paid or failed from the Online payments screen.',
  razorpay: 'Razorpay payment gateway. The key secret and webhook secret must be set on the server.',
};

interface Form {
  abdmMode: I.AbdmMode;
  hfrId: string;
  hipName: string;
  paymentProvider: I.PaymentProvider;
  paymentKeyId: string;
}

const SCREENS = [
  { href: '/integrations/abha', title: 'ABHA', desc: 'Create or verify ABHA and link it to patients. Care contexts shared with ABDM.', perm: 'integrations.abha.read', icon: FingerprintPattern },
  { href: '/integrations/scan-share', title: 'Scan & Share queue', desc: "Patients who scanned the hospital's ABDM QR code today.", perm: 'integrations.abha.read', icon: QrCode },
  { href: '/integrations/consents', title: 'ABDM consents', desc: 'Ask patients for consent and view records from other facilities.', perm: 'integrations.consent.read', icon: FileLock },
  { href: '/integrations/payments', title: 'Online payments', desc: 'Payment links for bills, with automatic posting to Billing.', perm: 'integrations.payment.read', icon: CreditCard },
  { href: '/integrations/devices', title: 'Lab machines', desc: 'HL7 v2 analyser interfaces and their message log.', perm: 'integrations.device.read', icon: Microscope },
  { href: '/integrations/developer', title: 'Developer', desc: 'Public API keys and outbound webhooks for third-party systems.', perm: 'integrations.developer.manage', icon: CodeXml },
] as const;

export default function IntegrationsPage() {
  const canManage = usePermission('integrations.settings.manage');
  const perms = {
    'integrations.abha.read': usePermission('integrations.abha.read'),
    'integrations.consent.read': usePermission('integrations.consent.read'),
    'integrations.payment.read': usePermission('integrations.payment.read'),
    'integrations.device.read': usePermission('integrations.device.read'),
    'integrations.developer.manage': usePermission('integrations.developer.manage'),
  };
  const anyAccess = canManage || Object.values(perms).some(Boolean);
  const queryClient = useQueryClient();

  const { data, isPending, error } = useQuery({
    queryKey: ['integrations', 'settings'],
    queryFn: () => api.integrations.settings.get(),
    enabled: anyAccess,
  });

  const [form, setForm] = React.useState<Form | null>(null);
  const current: Form | null =
    form ??
    (data
      ? { abdmMode: data.abdmMode, hfrId: data.hfrId ?? '', hipName: data.hipName ?? '', paymentProvider: data.paymentProvider, paymentKeyId: data.paymentKeyId ?? '' }
      : null);

  const save = useMutation({
    mutationFn: (f: Form) =>
      api.integrations.settings.update({
        abdmMode: f.abdmMode,
        hfrId: f.hfrId.trim() || null,
        hipName: f.hipName.trim() || null,
        paymentProvider: f.paymentProvider,
        paymentKeyId: f.paymentKeyId.trim() || null,
      }),
    onSuccess: (s) => {
      queryClient.setQueryData(['integrations', 'settings'], s);
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });

  if (!anyAccess) return <NoAccess />;
  const set = (patch: Partial<Form>) => current && setForm({ ...current, ...patch });
  const visibleScreens = SCREENS.filter((s) => perms[s.perm]);

  return (
    <>
      <PageHeader
        title="Integrations"
        description="ABDM (ABHA, Scan-and-Share, consents), online payments, lab machines and the public API. External systems run through adapters; mock mode never leaves this server."
      />

      {visibleScreens.length > 0 && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleScreens.map((s) => (
            <Link key={s.href} href={s.href} className="group">
              <Card className="h-full transition-colors group-hover:border-primary/50">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <s.icon className="size-4 text-primary" /> {s.title}
                    </CardTitle>
                    <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <CardDescription>{s.desc}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {error ? (
        <ErrorBox error={errorMessage(error)} />
      ) : isPending || !current || !data ? (
        <p className="text-sm text-muted-foreground">Loading settings…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Settings</CardTitle>
              <CardDescription>
                {canManage ? 'Secrets are never stored here; they live in server environment variables.' : 'Read only. Ask a hospital admin to change these.'}
                {data.updatedAt && <> Last changed {formatDateTime(data.updatedAt)}.</>}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-5 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canManage) save.mutate(current);
                }}
              >
                <div className="sm:col-span-2">
                  <ErrorBox error={save.error ? errorMessage(save.error) : null} />
                  {save.isSuccess && !form && <Notice tone="success">Settings saved.</Notice>}
                </div>

                <h3 className="text-sm font-semibold sm:col-span-2">ABDM</h3>
                <Field id="abdmMode" label="ABDM mode" hint={ABDM_MODE_HELP[current.abdmMode]} className="sm:col-span-2">
                  <Select id="abdmMode" disabled={!canManage} value={current.abdmMode} onChange={(e) => set({ abdmMode: e.target.value as I.AbdmMode })}>
                    <option value="disabled">Disabled</option>
                    <option value="mock">Mock (built-in simulator, OTP 123456)</option>
                    <option value="sandbox">ABDM sandbox</option>
                  </Select>
                </Field>
                {current.abdmMode === 'sandbox' && !data.serverReady.abdmSandbox && (
                  <Notice tone="warn" className="sm:col-span-2">
                    The server does not have ABDM sandbox credentials. Set them in the API environment before using sandbox mode, or calls will fail.
                  </Notice>
                )}
                <Field id="hfrId" label="HFR id (HIP id)" hint="Health Facility Registry id of this hospital.">
                  <Input id="hfrId" disabled={!canManage} value={current.hfrId} onChange={(e) => set({ hfrId: e.target.value })} placeholder="e.g. IN2710001234" />
                </Field>
                <Field id="hipName" label="HIP name" hint="Name shown to patients in the ABHA app.">
                  <Input id="hipName" disabled={!canManage} value={current.hipName} onChange={(e) => set({ hipName: e.target.value })} />
                </Field>

                <h3 className="pt-2 text-sm font-semibold sm:col-span-2">Online payments</h3>
                <Field id="paymentProvider" label="Payment provider" hint={PAYMENT_HELP[current.paymentProvider]}>
                  <Select id="paymentProvider" disabled={!canManage} value={current.paymentProvider} onChange={(e) => set({ paymentProvider: e.target.value as I.PaymentProvider })}>
                    <option value="none">None</option>
                    <option value="mock">Mock (built-in simulator)</option>
                    <option value="razorpay">Razorpay</option>
                  </Select>
                </Field>
                <Field id="paymentKeyId" label="Payment key id" hint="Public key id only, e.g. rzp_test_…">
                  <Input
                    id="paymentKeyId"
                    disabled={!canManage || current.paymentProvider === 'none'}
                    value={current.paymentKeyId}
                    onChange={(e) => set({ paymentKeyId: e.target.value })}
                  />
                </Field>
                {current.paymentProvider === 'razorpay' && !data.serverReady.razorpay && (
                  <Notice tone="warn" className="sm:col-span-2">
                    The server does not have Razorpay secrets configured. Set them in the API environment before creating payment links.
                  </Notice>
                )}

                {canManage && (
                  <div className="flex justify-end gap-2 sm:col-span-2">
                    <Button type="button" variant="outline" disabled={!form} onClick={() => setForm(null)}>
                      Reset
                    </Button>
                    <Button type="submit" disabled={save.isPending || !form}>
                      {save.isPending && <Loader2 className="animate-spin" />}
                      Save settings
                    </Button>
                  </div>
                )}
              </form>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Server readiness</CardTitle>
                <CardDescription>Whether the server has the secrets live adapters need.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span>ABDM sandbox</span>
                  {data.serverReady.abdmSandbox ? <Badge variant="accent">Ready</Badge> : <Badge variant="secondary">Not configured</Badge>}
                </div>
                <div className="flex items-center justify-between">
                  <span>Razorpay</span>
                  {data.serverReady.razorpay ? <Badge variant="accent">Ready</Badge> : <Badge variant="secondary">Not configured</Badge>}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Callback URLs</CardTitle>
                <CardDescription>Register these with ABDM and your payment gateway.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">ABDM profile share (Scan-and-Share)</p>
                  <CopyBox value={data.callbackUrls.abdmProfileShare} />
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Payment webhook</p>
                  {data.callbackUrls.paymentWebhook ? <CopyBox value={data.callbackUrls.paymentWebhook} /> : <p className="text-muted-foreground">Not applicable for this provider.</p>}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
