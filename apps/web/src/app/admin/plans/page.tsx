'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platform } from '@hms/shared';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { consoleApi } from '@/modules/platform/console/session';
import { useIsSuperAdmin } from '@/modules/platform/console/shell';
import { ErrorBox, MODULE_LABELS, StatusBadge, firstIssue, inr } from '@/modules/platform/ui';

const num = (v: string) => (v.trim() === '' ? null : Number(v));
const LABELS: Record<string, string> = {
  name: 'Name',
  description: 'Description',
  priceMonthly: 'Monthly price',
  priceYearly: 'Yearly price',
  trialDays: 'Trial days',
  'limits.facilities': 'Max facilities',
  'limits.users': 'Max users',
  'limits.beds': 'Max beds',
  sortOrder: 'Sort order',
};

const formFor = (plan: platform.Plan) => ({
  name: plan.name,
  description: plan.description,
  priceMonthly: plan.priceMonthly ?? '',
  priceYearly: plan.priceYearly ?? '',
  trialDays: String(plan.trialDays),
  facilities: plan.limits.facilities?.toString() ?? '',
  users: plan.limits.users?.toString() ?? '',
  beds: plan.limits.beds?.toString() ?? '',
  sortOrder: String(plan.sortOrder),
  modules: [...plan.modules],
});

function PlanEditor({ plan }: { plan: platform.Plan }) {
  const qc = useQueryClient();
  const isSuper = useIsSuperAdmin();
  const [f, setF] = React.useState(() => formFor(plan));
  const [saved, setSaved] = React.useState(false);
  const save = useMutation({
    mutationFn: (patch: platform.UpdatePlan) => {
      const problem = firstIssue(platform.updatePlanSchema, patch, LABELS);
      if (problem) throw new Error(problem);
      if (patch.modules && !patch.modules.length) throw new Error('Pick at least one module');
      return consoleApi.updatePlan(plan.code, patch);
    },
    onSuccess: () => {
      setSaved(true);
      void qc.invalidateQueries({ queryKey: ['console', 'plans'] });
    },
  });
  const field = (k: 'name' | 'priceMonthly' | 'priceYearly' | 'trialDays' | 'facilities' | 'users' | 'beds' | 'sortOrder', label: string, type: 'text' | 'number' = 'number') => (
    <div>
      <Label htmlFor={`${plan.code}-${k}`}>{label}</Label>
      <Input
        id={`${plan.code}-${k}`}
        className="mt-1"
        type={type}
        min={type === 'number' ? 0 : undefined}
        step={k === 'priceMonthly' || k === 'priceYearly' ? '0.01' : type === 'number' ? 1 : undefined}
        disabled={!isSuper}
        value={f[k]}
        onChange={(e) => {
          setSaved(false);
          setF((x) => ({ ...x, [k]: e.target.value }));
        }}
      />
    </div>
  );
  const toggleModule = (m: string) => {
    setSaved(false);
    setF((x) => ({ ...x, modules: x.modules.includes(m) ? x.modules.filter((y) => y !== m) : [...x.modules, m] }));
  };
  const submit = () => {
    save.mutate({
      name: f.name,
      description: f.description,
      priceMonthly: f.priceMonthly === '' ? null : f.priceMonthly,
      priceYearly: f.priceYearly === '' ? null : f.priceYearly,
      // Blank is reported as missing, not saved as 0.
      trialDays: f.trialDays.trim() === '' ? Number.NaN : Number(f.trialDays),
      limits: { facilities: num(f.facilities), users: num(f.users), beds: num(f.beds) },
      sortOrder: Number(f.sortOrder || 0),
      modules: f.modules as platform.UpdatePlan['modules'],
    });
  };
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
          <div className="col-span-2">{field('name', 'Name', 'text')}</div>
          {field('sortOrder', 'Sort order')}
          <div className="col-span-3">
            <Label htmlFor={`${plan.code}-description`}>Description</Label>
            <Input
              id={`${plan.code}-description`}
              className="mt-1"
              maxLength={500}
              disabled={!isSuper}
              value={f.description}
              onChange={(e) => {
                setSaved(false);
                setF((x) => ({ ...x, description: e.target.value }));
              }}
            />
          </div>
          {field('priceMonthly', 'Monthly ₹ (blank = custom)')}
          {field('priceYearly', 'Yearly ₹')}
          {field('trialDays', 'Trial days (0-90)')}
          {field('facilities', 'Max facilities (blank = no limit)')}
          {field('users', 'Max users')}
          {field('beds', 'Max beds')}
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Modules included</legend>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            {platform.ENTITLEMENT_MODULES.map((m) => (
              <label key={m} className="flex items-center gap-2">
                <input type="checkbox" disabled={!isSuper} checked={f.modules.includes(m)} onChange={() => toggleModule(m)} />
                {MODULE_LABELS[m] ?? m}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Hospitals on this plan gain or lose these modules within a minute of saving.</p>
        </fieldset>
        <ErrorBox error={save.error} />
        {saved && !save.isPending && <p className="text-sm text-muted-foreground">Saved.</p>}
        {isSuper && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={save.isPending} onClick={submit}>
              Save
            </Button>
            <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => setF(formFor(plan))}>
              Reset
            </Button>
            <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate({ isPublic: !plan.isPublic })}>
              {plan.isPublic ? 'Hide from signup' : 'Show on signup'}
            </Button>
            <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate({ isActive: !plan.isActive })}>
              {plan.isActive ? 'Deactivate' : 'Activate'}
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
      <div className="grid gap-4 lg:grid-cols-2">
        {plans.data?.map((p) => (
          <PlanEditor key={`${p.code}-${p.name}-${p.priceMonthly}-${p.trialDays}-${p.modules.join()}-${p.isActive}-${p.sortOrder}`} plan={p} />
        ))}
      </div>
    </>
  );
}
