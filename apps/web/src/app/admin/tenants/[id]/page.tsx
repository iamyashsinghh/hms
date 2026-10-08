'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { platform } from '@hms/shared';
import { formatDate } from '@/lib/format';
import { firstError, validate } from '@/lib/validate';
import { PageHeader } from '@/components/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { consoleApi } from '@/modules/platform/console/session';
import { useIsSuperAdmin } from '@/modules/platform/console/shell';
import { ErrorBox, MODULE_LABELS, Meter, StatusBadge, inr } from '@/modules/platform/ui';

type Detail = platform.TenantDetail;

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const isSuper = useIsSuperAdmin();
  const d = useQuery({ queryKey: ['console', 'tenant', id], queryFn: () => consoleApi.tenant(id) });
  const set = (data: Detail) => {
    qc.setQueryData(['console', 'tenant', id], data);
    qc.invalidateQueries({ queryKey: ['console', 'tenants'] });
  };

  if (d.isPending) return <Loader2 className="mx-auto mt-16 size-6 animate-spin text-muted-foreground" />;
  if (d.error) return <ErrorBox error={d.error} />;
  const t = d.data;

  return (
    <>
      <Link href="/admin/tenants" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> Hospitals
      </Link>
      <PageHeader
        title={t.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{t.code}</span> · joined {formatDate(t.createdAt)} · <StatusBadge status={t.status} />
          </span>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Meter label="Users" used={t.usage.users} max={t.entitlements.limits.users} />
            <Meter label="Facilities" used={t.usage.facilities} max={t.entitlements.limits.facilities} />
            <p className="text-sm text-muted-foreground">Patients registered: {t.usage.patients}</p>
            <p className="text-sm text-muted-foreground">
              Onboarding: {t.onboarding.done}/{t.onboarding.total} steps
            </p>
          </CardContent>
        </Card>
        <SubscriptionCard t={t} isSuper={isSuper} onDone={set} />
        {isSuper && <StatusCard t={t} onDone={set} />}
      </div>
      {isSuper && <EntitlementsCard t={t} onDone={set} />}
      <InvoicesCard t={t} isSuper={isSuper} onPaid={() => qc.invalidateQueries({ queryKey: ['console', 'tenant', id] })} />
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent tickets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {t.tickets.length === 0 && <p className="text-muted-foreground">No tickets.</p>}
          {t.tickets.map((k) => (
            <Link key={k.id} href={`/admin/tickets/${k.id}`} className="flex items-center justify-between rounded-md p-2 hover:bg-muted">
              <span>
                {k.number} · {k.subject}
              </span>
              <StatusBadge status={k.status} />
            </Link>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

function SubscriptionCard({ t, isSuper, onDone }: { t: Detail; isSuper: boolean; onDone: (d: Detail) => void }) {
  const plans = useQuery({ queryKey: ['console', 'plans'], queryFn: () => consoleApi.plans() });
  const s = t.subscription;
  const [planCode, setPlanCode] = React.useState(t.planCode);
  const [cycle, setCycle] = React.useState<platform.BillingCycle>(s?.billingCycle ?? 'monthly');
  const [price, setPrice] = React.useState('');
  const [trialDays, setTrialDays] = React.useState('');
  const [formError, setFormError] = React.useState<string | null>(null);
  const subBody = (mode: 'plan' | 'trial' | 'activate'): platform.AdminSetSubscription => ({
    planCode,
    billingCycle: cycle,
    price: price.trim() ? price.trim() : undefined,
    trialEndsAt: mode === 'trial' && trialDays ? new Date(Date.now() + Number(trialDays) * 86_400_000).toISOString() : undefined,
    activateNow: mode === 'activate',
  });
  const save = useMutation({
    mutationFn: (mode: 'plan' | 'trial' | 'activate') => consoleApi.setSubscription(t.id, subBody(mode)),
    onSuccess: onDone,
  });
  const submit = (mode: 'plan' | 'trial' | 'activate') => {
    let message: string | null = null;
    if (mode === 'trial' && !(Number.isInteger(Number(trialDays)) && Number(trialDays) >= 1 && Number(trialDays) <= 365)) message = 'Trial days must be a whole number from 1 to 365';
    message ??= firstError(validate(platform.adminSetSubscriptionSchema, subBody(mode)).errors);
    setFormError(message);
    if (!message) save.mutate(mode);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Subscription {s && <StatusBadge status={s.status} />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {s ? (
          <p className="text-muted-foreground">
            <span className="capitalize">{s.planCode}</span> · {s.billingCycle} · {s.price ? `${inr(s.price)} custom` : 'list price'}
            <br />
            {s.status === 'trial' ? `Trial ends ${formatDate(s.trialEndsAt)}` : `Period ends ${formatDate(s.currentPeriodEnd)}`}
            {s.cancelAtPeriodEnd && ' · cancels at period end'}
          </p>
        ) : (
          <p className="text-muted-foreground">No subscription (legacy hospital on {t.planCode}).</p>
        )}
        {isSuper && (
          <div className="space-y-3 border-t pt-3">
            <div className="grid grid-cols-2 gap-2">
              <Select value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
                {plans.data?.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Select value={cycle} onChange={(e) => setCycle(e.target.value as platform.BillingCycle)}>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </Select>
              <Input placeholder="Custom price" aria-label="Custom price" inputMode="decimal" maxLength={15} value={price} onChange={(e) => setPrice(e.target.value)} />
              <Input placeholder="Trial days" aria-label="Trial days" type="number" min={1} max={365} step={1} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
            </div>
            <ErrorBox error={formError ? new Error(formError) : save.error} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => submit('plan')}>
                Change plan
              </Button>
              <Button size="sm" variant="outline" disabled={save.isPending || !trialDays} onClick={() => submit('trial')}>
                Set trial
              </Button>
              <Button size="sm" disabled={save.isPending} onClick={() => submit('activate')}>
                Activate (contract)
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusCard({ t, onDone }: { t: Detail; onDone: (d: Detail) => void }) {
  const [reason, setReason] = React.useState('');
  const change = useMutation({
    mutationFn: (status: 'active' | 'suspended' | 'closed') => consoleApi.setTenantStatus(t.id, { status, reason }),
    onSuccess: (d) => {
      setReason('');
      onDone(d);
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Account status</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">Suspending signs every user out. Billing payments do not lift a manual suspension.</p>
        <Input placeholder="Reason (required)" aria-label="Reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        <ErrorBox error={change.error} />
        <div className="flex flex-wrap gap-2">
          {t.status !== 'active' && (
            <Button size="sm" disabled={reason.trim().length < 3 || change.isPending} onClick={() => change.mutate('active')}>
              Reactivate
            </Button>
          )}
          {t.status !== 'suspended' && (
            <Button size="sm" variant="destructive" disabled={reason.trim().length < 3 || change.isPending} onClick={() => change.mutate('suspended')}>
              Suspend
            </Button>
          )}
          {t.status !== 'closed' && (
            <Button size="sm" variant="outline" disabled={reason.trim().length < 3 || change.isPending} onClick={() => change.mutate('closed')}>
              Close account
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function EntitlementsCard({ t, onDone }: { t: Detail; onDone: (d: Detail) => void }) {
  const overrides = new Map(t.overrides.map((o) => [o.moduleKey, o.enabled]));
  const [limits, setLimits] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(platform.LIMIT_KEYS.map((k) => [k, t.limitOverrides[k] === undefined ? '' : String(t.limitOverrides[k] ?? -1)])),
  );
  const [limitError, setLimitError] = React.useState<string | null>(null);
  const save = useMutation({ mutationFn: (body: platform.AdminSetEntitlements) => consoleApi.setEntitlements(t.id, body), onSuccess: onDone });
  const cycle = (key: string) => {
    const cur = overrides.get(key);
    // plan default → force on → force off → plan default
    const next = cur === undefined ? true : cur ? false : null;
    save.mutate({ modules: { [key]: next } as platform.AdminSetEntitlements['modules'] });
  };
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Modules and limits</CardTitle>
        <p className="text-sm text-muted-foreground">Click a module to cycle: plan default → added → removed.</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2">
          {platform.ENTITLEMENT_MODULES.map((m) => {
            const on = t.entitlements.modules.includes(m);
            const o = overrides.get(m);
            return (
              <button
                key={m}
                type="button"
                disabled={save.isPending}
                onClick={() => cycle(m)}
                className={`rounded-full border px-3 py-1 text-xs ${on ? 'border-accent bg-accent/10 text-accent-foreground' : 'text-muted-foreground line-through'} ${o !== undefined ? 'ring-2 ring-amber-400' : ''}`}
                title={o === undefined ? 'Plan default' : o ? 'Added by override' : 'Removed by override'}
              >
                {MODULE_LABELS[m] ?? m}
              </button>
            );
          })}
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          {platform.LIMIT_KEYS.map((k) => (
            <div key={k}>
              <Label htmlFor={`lim-${k}`} className="capitalize">
                {k} (plan {t.entitlements.limits[k] ?? '∞'})
              </Label>
              <Input
                id={`lim-${k}`}
                className="mt-2"
                type="number"
                min={-1}
                step={1}
                placeholder="Plan default"
                value={limits[k]}
                onChange={(e) => setLimits((l) => ({ ...l, [k]: e.target.value }))}
              />
            </div>
          ))}
          <div className="flex items-end">
            <Button
              variant="outline"
              disabled={save.isPending}
              onClick={() => {
                const body: platform.AdminSetEntitlements = {
                  limits: Object.fromEntries(platform.LIMIT_KEYS.map((k) => [k, (limits[k] ?? '').trim() === '' ? null : Number(limits[k])])) as platform.AdminSetEntitlements['limits'],
                };
                const v = validate(platform.adminSetEntitlementsSchema, body);
                const key = v.errors ? Object.keys(v.errors)[0] : undefined;
                const message = key ? `${key.split('.').pop()}: ${v.errors![key]}` : null;
                setLimitError(message);
                if (!message) save.mutate(body);
              }}
            >
              Save limits
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Use -1 for unlimited; leave blank for the plan limit.</p>
        <ErrorBox error={limitError ? new Error(limitError) : save.error} />
      </CardContent>
    </Card>
  );
}

function InvoicesCard({ t, isSuper, onPaid }: { t: Detail; isSuper: boolean; onPaid: () => void }) {
  const pay = useMutation({ mutationFn: (id: string) => consoleApi.markInvoicePaid(id, { mode: 'bank_transfer' }), onSuccess: onPaid });
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Invoices</CardTitle>
      </CardHeader>
      <ErrorBox error={pay.error} />
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Number</TableHead>
            <TableHead>Period</TableHead>
            <TableHead>Total</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {t.invoices.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="font-mono text-xs">{i.number}</TableCell>
              <TableCell>
                {formatDate(i.periodStart)} – {formatDate(i.periodEnd)}
              </TableCell>
              <TableCell>{inr(i.total)}</TableCell>
              <TableCell>
                <StatusBadge status={i.status} /> {i.paymentMode && <span className="text-xs text-muted-foreground">{i.paymentMode}</span>}
              </TableCell>
              <TableCell className="text-right">
                {isSuper && i.status === 'issued' && (
                  <Button size="sm" variant="outline" disabled={pay.isPending} onClick={() => pay.mutate(i.id)}>
                    Mark paid (bank)
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
