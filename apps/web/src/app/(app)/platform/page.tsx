'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CreditCard, Loader2 } from 'lucide-react';
import type { platform as P } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AnnouncementsBanner, ErrorBox, MODULE_LABELS, Meter, StatusBadge, inr } from '@/modules/platform/ui';
import { cn } from '@/lib/utils';

export default function SubscriptionPage() {
  const canRead = usePermission('platform.subscription.read');
  const canManage = usePermission('platform.subscription.manage');
  const qc = useQueryClient();
  const [cycle, setCycle] = React.useState<P.BillingCycle>('monthly');

  const sub = useQuery({ queryKey: ['platform', 'subscription'], queryFn: () => api.platform.subscription(), enabled: canRead });
  const plans = useQuery({ queryKey: ['platform', 'plans'], queryFn: () => api.platform.plans(), enabled: canRead });

  const done = (data: P.SubscriptionOverview) => {
    qc.setQueryData(['platform', 'subscription'], data);
    qc.invalidateQueries({ queryKey: ['platform'] });
  };
  const change = useMutation({ mutationFn: (body: P.ChangePlan) => api.platform.changePlan(body), onSuccess: done });
  const checkout = useMutation({
    mutationFn: async () => {
      const inv = await api.platform.checkout();
      return api.platform.payInvoice(inv.id, { mode: 'sandbox' });
    },
    onSuccess: done,
  });
  const pay = useMutation({ mutationFn: (id: string) => api.platform.payInvoice(id, { mode: 'sandbox' }), onSuccess: done });
  const cancel = useMutation({ mutationFn: (c: boolean) => api.platform.cancel({ cancel: c }), onSuccess: done });

  if (!canRead) return <NoAccess />;
  if (sub.isPending) return <Loader2 className="mx-auto mt-16 size-6 animate-spin text-muted-foreground" />;
  if (sub.error) return <ErrorBox error={sub.error} />;

  const o = sub.data;
  const s = o.subscription;
  const openInvoice = o.invoices.find((i) => i.status === 'issued');
  const actionError = change.error ?? checkout.error ?? pay.error ?? cancel.error;

  return (
    <>
      <PageHeader title="Subscription & plan" description={`${o.tenant.name} · hospital code ${o.tenant.code}`} />
      <AnnouncementsBanner className="mb-6" />
      {actionError && (
        <div className="mb-4">
          <ErrorBox error={new Error(errorMessage(actionError))} />
        </div>
      )}

      {o.tenant.status === 'grace' && (
        <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Your payment is overdue. Please pay the open invoice to avoid suspension after the 7-day grace period.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-3">
              <CardTitle className="text-xl">{o.plan.name} plan</CardTitle>
              {s && <StatusBadge status={s.status} />}
              {o.tenant.status !== 'active' && o.tenant.status !== s?.status && <StatusBadge status={o.tenant.status} />}
            </div>
            <CardDescription>{o.plan.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {s?.status === 'trial' && (
              <p>
                Free trial: <b>{o.trialDaysLeft} days left</b> (ends {formatDate(s.trialEndsAt)}). Pay now to keep using HMS after the trial;
                paid days start when the trial ends.
              </p>
            )}
            {s?.status === 'active' && s.currentPeriodEnd && (
              <p>
                {s.cancelAtPeriodEnd ? 'Cancels' : 'Renews'} on <b>{formatDate(s.currentPeriodEnd)}</b> · {inr(s.price ?? (s.billingCycle === 'yearly' ? o.plan.priceYearly : o.plan.priceMonthly))} /{' '}
                {s.billingCycle === 'yearly' ? 'year' : 'month'} + GST
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Can permission="platform.subscription.manage">
                {openInvoice ? (
                  <Button onClick={() => pay.mutate(openInvoice.id)} disabled={pay.isPending}>
                    {pay.isPending ? <Loader2 className="animate-spin" /> : <CreditCard />} Pay {inr(openInvoice.total)} (test payment)
                  </Button>
                ) : (
                  s?.status === 'trial' && (
                    <Button onClick={() => checkout.mutate()} disabled={checkout.isPending}>
                      {checkout.isPending ? <Loader2 className="animate-spin" /> : <CreditCard />} Pay now (test payment)
                    </Button>
                  )
                )}
                {s && (
                  <Button variant="outline" onClick={() => cancel.mutate(!s.cancelAtPeriodEnd)} disabled={cancel.isPending}>
                    {s.cancelAtPeriodEnd ? 'Keep my subscription' : 'Cancel at period end'}
                  </Button>
                )}
              </Can>
            </div>
            <p className="text-xs text-muted-foreground">Payments run in sandbox mode: no money is charged.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Meter label="Users" used={o.usage.users} max={o.entitlements.limits.users} />
            <Meter label="Facilities" used={o.usage.facilities} max={o.entitlements.limits.facilities} />
            <Link href="/platform/onboarding" className={buttonVariants({ variant: 'link', className: 'px-0' })}>
              Getting-started checklist
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="mb-3 mt-10 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Plans</h2>
        <div className="flex rounded-md border bg-card p-0.5 text-sm">
          {(['monthly', 'yearly'] as const).map((c) => (
            <button key={c} type="button" onClick={() => setCycle(c)} className={cn('rounded px-3 py-1', cycle === c && 'bg-primary text-primary-foreground')}>
              {c === 'monthly' ? 'Monthly' : 'Yearly (2 months free)'}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {plans.data?.map((p) => {
          const price = cycle === 'yearly' ? p.priceYearly : p.priceMonthly;
          const current = p.code === o.plan.code && (s?.billingCycle ?? 'monthly') === cycle;
          return (
            <Card key={p.code} className={cn(p.code === o.plan.code && 'border-primary ring-1 ring-primary')}>
              <CardHeader>
                <CardTitle>{p.name}</CardTitle>
                <p className="text-2xl font-semibold">
                  {inr(price)}
                  {price !== null && <span className="text-sm font-normal text-muted-foreground"> / {cycle === 'yearly' ? 'year' : 'month'} + GST</span>}
                </p>
                <CardDescription>{p.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  {p.limits.facilities ?? 'Unlimited'} {p.limits.facilities === 1 ? 'facility' : 'facilities'} · {p.limits.users ?? 'Unlimited'} users
                  {p.limits.beds ? ` · ${p.limits.beds} beds` : ''}
                </p>
                <ul className="space-y-1">
                  {p.modules.map((m) => (
                    <li key={m} className="flex items-center gap-2">
                      <Check className="size-3.5 text-accent" /> {MODULE_LABELS[m] ?? m}
                    </li>
                  ))}
                </ul>
                {canManage &&
                  (current ? (
                    <Button variant="secondary" disabled className="w-full">
                      Current plan
                    </Button>
                  ) : price === null ? (
                    <Link href="/platform/support/new?category=billing" className={buttonVariants({ variant: 'outline', className: 'w-full' })}>
                      Contact sales
                    </Link>
                  ) : (
                    <Button className="w-full" variant="outline" disabled={change.isPending} onClick={() => change.mutate({ planCode: p.code, billingCycle: cycle })}>
                      Switch to {p.name}
                    </Button>
                  ))}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <h2 className="mb-3 mt-10 text-lg font-semibold">Invoices</h2>
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Number</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {o.invoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No invoices yet.
                </TableCell>
              </TableRow>
            ) : (
              o.invoices.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-mono text-xs">{i.number}</TableCell>
                  <TableCell className="capitalize">{i.planCode}</TableCell>
                  <TableCell>
                    {formatDate(i.periodStart)} – {formatDate(i.periodEnd)}
                  </TableCell>
                  <TableCell>{inr(i.total)}</TableCell>
                  <TableCell>{formatDate(i.dueAt)}</TableCell>
                  <TableCell>
                    <StatusBadge status={i.status} />
                    {i.paymentRef && <span className="ml-2 font-mono text-xs text-muted-foreground">{i.paymentRef}</span>}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
