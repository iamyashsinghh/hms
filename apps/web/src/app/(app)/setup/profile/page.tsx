'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { setup } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ErrorBox, Field, S, SuccessBox, opt } from '@/modules/setup/ui';

const clean = <T extends Record<string, unknown> | undefined>(o: T): T | undefined =>
  o && Object.values(o).some((v) => v !== undefined && v !== '') ? o : undefined;

export default function ProfilePage() {
  const canRead = usePermission('setup.profile.read');
  const canManage = usePermission('setup.profile.manage');
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({ queryKey: ['setup', 'profile'], queryFn: () => api.setup.getProfile(), enabled: canRead });

  const form = useForm({ resolver: zodResolver(S.upsertProfileSchema) });
  const { register, handleSubmit, reset, formState } = form;
  const { errors } = formState;

  React.useEffect(() => {
    if (!data) return;
    const strip = <T extends object>(o: T | null) =>
      o ? (Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as T) : undefined;
    reset({
      ...strip(data),
      address: data.address ?? undefined,
      letterhead: data.letterhead ?? undefined,
    } as setup.UpsertProfile);
  }, [data, reset]);

  const save = useMutation({
    mutationFn: (body: setup.UpsertProfile) => api.setup.saveProfile(body),
    onSuccess: (p) => {
      queryClient.setQueryData(['setup', 'profile'], p);
      queryClient.invalidateQueries({ queryKey: ['setup', 'wizard'] });
    },
  });

  if (!canRead) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;

  const onSubmit = handleSubmit((v) => save.mutate({ ...v, address: clean(v.address), letterhead: clean(v.letterhead) }));

  return (
    <div className="max-w-4xl">
      <PageHeader title="Hospital profile" description="Shown on bills, prescriptions and reports." />
      <form onSubmit={onSubmit} noValidate className="space-y-6">
        <ErrorBox error={save.error} />
        {save.isSuccess && !formState.isDirty && <SuccessBox>Profile saved.</SuccessBox>}
        <fieldset disabled={!canManage} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Legal details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <Field id="legalName" label="Legal name *" error={errors.legalName}>
                <Input id="legalName" aria-invalid={!!errors.legalName} {...register('legalName')} />
              </Field>
              <Field id="displayName" label="Display name *" error={errors.displayName}>
                <Input id="displayName" aria-invalid={!!errors.displayName} {...register('displayName')} />
              </Field>
              <Field id="gstin" label="GSTIN" error={errors.gstin} hint="15 characters, e.g. 27AAPFU0939F1ZV">
                <Input id="gstin" className="uppercase" aria-invalid={!!errors.gstin} {...register('gstin', opt)} />
              </Field>
              <Field id="pan" label="PAN" error={errors.pan}>
                <Input id="pan" className="uppercase" aria-invalid={!!errors.pan} {...register('pan', opt)} />
              </Field>
              <Field id="registrationNo" label="Clinical establishment reg. no" error={errors.registrationNo}>
                <Input id="registrationNo" {...register('registrationNo', opt)} />
              </Field>
              <Field id="accreditation" label="Accreditation (NABH, ROHINI id…)" error={errors.accreditation}>
                <Input id="accreditation" {...register('accreditation', opt)} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contact &amp; address</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <Field id="phone" label="Phone" error={errors.phone}>
                <Input id="phone" type="tel" {...register('phone', opt)} />
              </Field>
              <Field id="email" label="Email" error={errors.email}>
                <Input id="email" type="email" aria-invalid={!!errors.email} {...register('email', opt)} />
              </Field>
              <Field id="website" label="Website" error={errors.website}>
                <Input id="website" placeholder="https://" aria-invalid={!!errors.website} {...register('website', opt)} />
              </Field>
              <Field id="timezone" label="Timezone" error={errors.timezone}>
                <Input id="timezone" {...register('timezone')} />
              </Field>
              <Field id="line1" label="Address line 1" error={errors.address?.line1} className="sm:col-span-2">
                <Input id="line1" {...register('address.line1', opt)} />
              </Field>
              <Field id="line2" label="Address line 2" error={errors.address?.line2} className="sm:col-span-2">
                <Input id="line2" {...register('address.line2', opt)} />
              </Field>
              <Field id="city" label="City" error={errors.address?.city}>
                <Input id="city" {...register('address.city', opt)} />
              </Field>
              <Field id="district" label="District" error={errors.address?.district}>
                <Input id="district" {...register('address.district', opt)} />
              </Field>
              <Field id="state" label="State" error={errors.address?.state}>
                <Input id="state" {...register('address.state', opt)} />
              </Field>
              <Field id="pincode" label="PIN code" error={errors.address?.pincode}>
                <Input id="pincode" inputMode="numeric" aria-invalid={!!errors.address?.pincode} {...register('address.pincode', opt)} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Letterhead</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <Field id="logoUrl" label="Logo URL" error={errors.logoUrl} className="sm:col-span-2">
                <Input id="logoUrl" placeholder="https://" aria-invalid={!!errors.logoUrl} {...register('logoUrl', opt)} />
              </Field>
              <Field id="tagline" label="Tagline" error={errors.letterhead?.tagline}>
                <Input id="tagline" {...register('letterhead.tagline', opt)} />
              </Field>
              <Field id="accentColor" label="Accent colour" error={errors.letterhead?.accentColor} hint="Hex, e.g. #0f766e">
                <Input id="accentColor" {...register('letterhead.accentColor', opt)} />
              </Field>
              <Field id="headerNote" label="Header note" error={errors.letterhead?.headerNote} className="sm:col-span-2">
                <Input id="headerNote" {...register('letterhead.headerNote', opt)} />
              </Field>
              <Field id="footerNote" label="Footer note" error={errors.letterhead?.footerNote} className="sm:col-span-2">
                <Input id="footerNote" placeholder="e.g. Emergency 24x7: 020-1234 5678" {...register('letterhead.footerNote', opt)} />
              </Field>
            </CardContent>
          </Card>
        </fieldset>
        {canManage && (
          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              Save profile
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
