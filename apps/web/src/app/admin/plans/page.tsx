'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platform } from '@hms/shared';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { firstError, validate } from '@/lib/validate';
import { consoleApi } from '@/modules/platform/console/session';
import { useIsSuperAdmin } from '@/modules/platform/console/shell';
import { ErrorBox, MODULE_LABELS, StatusBadge, inr } from '@/modules/platform/ui';

const num = (v: string) => (v.trim() === '' ? null : Number(v));

function PlanEditor({ plan }: { plan: platform.Plan }) {
  const qc = useQueryClient();
  const isSuper = useIsSuperAdmin();
  const [f, setF] = React.useState({
    priceMonthly: plan.priceMonthly ?? '',
    priceYearly: plan.priceYearly ?? '',
    trialDays: String(plan.trialDays),
    facilities: plan.limits.facilities?.toString() ?? '',
    users: plan.limits.users?.toString() ?? '',
    beds: plan.limits.beds?.toString() ?? '',
  });
  const [formError, setFormError] = React.useState<string | null>(null);
  const save = useMutation({
    mutationFn: (patch: platform.UpdatePlan) => consoleApi.updatePlan(plan.code, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['console', 'plans'] }),
  });
  const field = (k: keyof typeof f, label: string) => (
    <div>
      <Label htmlFor={`${plan.code}-${k}`}>{label}</Label>
      <Input id={`${plan.code}-${k}`} className="mt-1" inputMode="decimal" disabled={!isSuper} value={f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} />
    </div>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {plan.name} <span className="font-mono text-xs text-muted-foreground">{plan.code}</span>
          {!plan.isActive && <StatusBadge status="cancelled" />}
          {!plan.isPublic && <span className="text-xs text-muted-foreground">hidden</span>}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {inr(plan.priceMonthly)} / month · {inr(plan.priceYearly)} / year
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
          {field('priceMonthly', 'Monthly ₹ (blank = custom)')}
          {field('priceYearly', 'Yearly ₹')}
          {field('trialDays', 'Trial days')}
          {field('facilities', 'Max facilities')}
          {field('users', 'Max users')}
          {field('beds', 'Max beds')}
        </div>
        <p className="text-xs text-muted-foreground">{plan.modules.map((m) => MODULE_LABELS[m] ?? m).join(' · ')}</p>
        <ErrorBox error={formError ? new Error(formError) : save.error} />
        {isSuper && (
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={save.isPending}
              onClick={() => {
                const patch: platform.UpdatePlan = {
                  priceMonthly: f.priceMonthly === '' ? null : f.priceMonthly,
                  priceYearly: f.priceYearly === '' ? null : f.priceYearly,
                  trialDays: f.trialDays.trim() === '' ? Number.NaN : Number(f.trialDays),
                  limits: { facilities: num(f.facilities), users: num(f.users), beds: num(f.beds) },
                };
                const v = validate(platform.updatePlanSchema, patch);
                const message = firstError(v.errors);
                setFormError(message);
                if (!message) save.mutate(patch);
              }}
            >
              Save
            </Button>
            <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate({ isPublic: !plan.isPublic })}>
              {plan.isPublic ? 'Hide from signup' : 'Show on signup'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ConsolePlansPage() {
  const plans = useQuery({ queryKey: ['console', 'plans'], queryFn: () => consoleApi.plans() });
  return (
    <>
      <PageHeader title="Plans" description="Prices are estimates until pricing is final. Changes apply to hospitals on the plan within a minute." />
      <ErrorBox error={plans.error} />
      <div className="grid gap-4 lg:grid-cols-2">{plans.data?.map((p) => <PlanEditor key={`${p.code}-${p.priceMonthly}-${p.trialDays}`} plan={p} />)}</div>
    </>
  );
}
