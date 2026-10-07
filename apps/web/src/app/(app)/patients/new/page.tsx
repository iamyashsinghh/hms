'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { BLOOD_GROUPS, GENDERS, createPatientSchema, type CreatePatient } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { genderLabel } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { FieldError } from '@/components/field-error';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// HTML inputs give '' for empty fields; the schema wants them absent.
const opt = { setValueAs: (v: string) => (v === '' ? undefined : v) };
const optNumber = { setValueAs: (v: string) => (v === '' ? undefined : Number(v)) };
const list = {
  setValueAs: (v: string | string[] | undefined) => {
    if (Array.isArray(v)) return v;
    const items = (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return items.length ? items : undefined;
  },
};

function Field({ id, label, error, children, className }: { id: string; label: string; error?: { message?: string }; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-2">{children}</div>
      <div className="mt-1">
        <FieldError error={error} />
      </div>
    </div>
  );
}

export default function NewPatientPage() {
  const canCreate = usePermission('core.patient.create');
  const router = useRouter();
  const queryClient = useQueryClient();

  const { register, handleSubmit, formState } = useForm({
    resolver: zodResolver(createPatientSchema),
    defaultValues: { firstName: '', gender: 'male' },
  });
  const { errors } = formState;

  const create = useMutation({
    mutationFn: (body: CreatePatient) => api.patients.create(body),
    onSuccess: (patient) => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      router.push(`/patients/${patient.id}`);
    },
  });

  if (!canCreate) return <NoAccess />;

  const onSubmit = handleSubmit((values) => {
    const address = values.address && Object.values(values.address).some(Boolean) ? values.address : undefined;
    create.mutate({ ...values, address });
  });

  return (
    <div className="max-w-4xl">
      <Link href="/patients" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> All patients
      </Link>
      <PageHeader title="Register patient" description="A UHID is generated when the patient is saved." />

      <form onSubmit={onSubmit} noValidate className="space-y-6">
        {create.error && (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {errorMessage(create.error)}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Personal details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <Field id="firstName" label="First name *" error={errors.firstName}>
              <Input id="firstName" aria-invalid={!!errors.firstName} {...register('firstName')} />
            </Field>
            <Field id="lastName" label="Last name" error={errors.lastName}>
              <Input id="lastName" {...register('lastName', opt)} />
            </Field>
            <Field id="gender" label="Gender *" error={errors.gender}>
              <Select id="gender" {...register('gender')}>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {genderLabel(g)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="bloodGroup" label="Blood group" error={errors.bloodGroup}>
              <Select id="bloodGroup" {...register('bloodGroup', opt)}>
                <option value="">Unknown</option>
                {BLOOD_GROUPS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="dateOfBirth" label="Date of birth" error={errors.dateOfBirth}>
              <Input id="dateOfBirth" type="date" aria-invalid={!!errors.dateOfBirth} {...register('dateOfBirth', opt)} />
            </Field>
            <Field id="ageYears" label="Age (years, if DOB unknown)" error={errors.ageYears}>
              <Input id="ageYears" type="number" min={0} max={150} aria-invalid={!!errors.ageYears} {...register('ageYears', optNumber)} />
            </Field>
            <Field id="abhaNumber" label="ABHA number" error={errors.abhaNumber}>
              <Input id="abhaNumber" inputMode="numeric" placeholder="14 digits" aria-invalid={!!errors.abhaNumber} {...register('abhaNumber', opt)} />
            </Field>
            <Field id="allergies" label="Allergies" error={errors.allergies}>
              <Input id="allergies" placeholder="Comma separated, e.g. Penicillin, Peanuts" {...register('allergies', list)} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contact &amp; address</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <Field id="mobile" label="Mobile" error={errors.mobile}>
              <Input id="mobile" type="tel" inputMode="numeric" placeholder="10-digit mobile" aria-invalid={!!errors.mobile} {...register('mobile', opt)} />
            </Field>
            <Field id="email" label="Email" error={errors.email}>
              <Input id="email" type="email" aria-invalid={!!errors.email} {...register('email', opt)} />
            </Field>
            <Field id="line1" label="Address" error={errors.address?.line1} className="sm:col-span-2">
              <Input id="line1" {...register('address.line1', opt)} />
            </Field>
            <Field id="city" label="City" error={errors.address?.city}>
              <Input id="city" {...register('address.city', opt)} />
            </Field>
            <Field id="state" label="State" error={errors.address?.state}>
              <Input id="state" {...register('address.state', opt)} />
            </Field>
            <Field id="pincode" label="PIN code" error={errors.address?.pincode}>
              <Input id="pincode" inputMode="numeric" aria-invalid={!!errors.address?.pincode} {...register('address.pincode', opt)} />
            </Field>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Link href="/patients" className={buttonVariants({ variant: 'outline' })}>
            Cancel
          </Link>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending && <Loader2 className="animate-spin" />}
            Register patient
          </Button>
        </div>
      </form>
    </div>
  );
}
