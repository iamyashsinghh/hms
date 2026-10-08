'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { platform } from '@hms/shared';
import { PageHeader } from '@/components/page-header';
import { FieldError } from '@/components/field-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { consoleApi } from '@/modules/platform/console/session';
import { ErrorBox } from '@/modules/platform/ui';

const TEXT_FIELDS = [
  ['hospitalName', 'Hospital name'],
  ['code', 'Hospital code'],
  ['adminName', 'Admin name'],
  ['email', 'Admin email'],
  ['mobile', 'Admin mobile'],
  ['password', 'Temporary password'],
  ['city', 'City'],
  ['state', 'State'],
] as const;

export default function NewTenantPage() {
  const router = useRouter();
  const plans = useQuery({ queryKey: ['console', 'plans'], queryFn: () => consoleApi.plans() });
  const { register, handleSubmit, formState } = useForm({
    resolver: zodResolver(platform.adminCreateTenantSchema),
    defaultValues: { planCode: 'starter', facilityType: 'hospital' as const, startActive: false },
  });
  const create = useMutation({
    mutationFn: (b: platform.AdminCreateTenant) => consoleApi.createTenant(b),
    onSuccess: (r) => router.push(`/admin/tenants/${r.tenantId}`),
  });
  const e = formState.errors as Record<string, { message?: string } | undefined>;
  return (
    <div className="max-w-3xl">
      <PageHeader title="Add hospital" description="Creates the hospital, its first facility and an admin login." />
      <form noValidate onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-5">
        <ErrorBox error={create.error} />
        <Card>
          <CardContent className="grid gap-5 pt-6 sm:grid-cols-2">
            {TEXT_FIELDS.map(([name, label]) => (
              <div key={name}>
                <Label htmlFor={name}>{label}</Label>
                <Input id={name} className="mt-2" {...register(name, { setValueAs: (v: string) => (v === '' ? undefined : v) })} />
                <FieldError error={e[name]} />
              </div>
            ))}
            <div>
              <Label htmlFor="planCode">Plan</Label>
              <Select id="planCode" className="mt-2" {...register('planCode')}>
                {plans.data?.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="trialDays">Trial days (blank = plan default)</Label>
              <Input id="trialDays" type="number" min={0} max={180} step={1} className="mt-2" {...register('trialDays', { setValueAs: (v: string) => (v === '' ? undefined : Number(v)) })} />
              <FieldError error={e.trialDays} />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" {...register('startActive')} /> Start active (signed contract, skip the trial)
            </label>
          </CardContent>
        </Card>
        <div className="flex justify-end">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending && <Loader2 className="animate-spin" />} Create hospital
          </Button>
        </div>
      </form>
    </div>
  );
}
