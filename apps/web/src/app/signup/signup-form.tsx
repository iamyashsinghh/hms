'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { platform } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/field-error';
import { inr } from '@/modules/platform/ui';

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);

function Field({ id, label, error, hint, children, className }: { id: string; label: string; error?: { message?: string }; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-2">{children}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      <FieldError error={error} />
    </div>
  );
}

export function SignupForm() {
  const plans = useQuery({ queryKey: ['platform', 'plans', 'public'], queryFn: () => api.platform.plans() });
  const { register, handleSubmit, control, setValue, formState, getFieldState } = useForm({
    resolver: zodResolver(platform.signupSchema),
    defaultValues: { hospitalName: '', code: '', adminName: '', email: '', mobile: '', password: '', planCode: 'starter', facilityType: 'hospital' as const },
  });
  const { errors } = formState;
  const code = useWatch({ control, name: 'code' }) ?? '';
  const name = useWatch({ control, name: 'hospitalName' }) ?? '';

  // Suggest a code from the name until the user edits it.
  React.useEffect(() => {
    if (!getFieldState('code').isDirty) setValue('code', slug(name));
  }, [name, setValue, getFieldState]);

  const [debounced, setDebounced] = React.useState(code);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(code), 400);
    return () => clearTimeout(t);
  }, [code]);
  const availability = useQuery({
    queryKey: ['platform', 'code', debounced],
    queryFn: () => api.platform.codeAvailability(debounced),
    enabled: debounced.length >= 3,
    retry: false,
  });

  const signup = useMutation({ mutationFn: (body: platform.Signup) => api.platform.signup(body) });

  if (signup.data) {
    return (
      <div className="text-center">
        <CheckCircle2 className="mx-auto size-12 text-accent" />
        <h1 className="mt-4 text-2xl font-semibold">Your hospital is ready</h1>
        <p className="mt-2 text-muted-foreground">
          Sign in with hospital code <b className="font-mono text-foreground">{signup.data.code}</b> and the email and password you just chose.
          {signup.data.trialEndsAt && ` Your trial runs until ${new Date(signup.data.trialEndsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}.`}
        </p>
        <Link href={signup.data.loginUrl} className={buttonVariants({ className: 'mt-6' })}>
          Go to sign in
        </Link>
      </div>
    );
  }

  const codeHint =
    availability.data && debounced === code
      ? availability.data.available
        ? <span className="text-accent-foreground">Available. Staff will sign in with this code.</span>
        : <span className="text-destructive">{availability.data.reason === 'invalid' ? 'Use 3-31 lowercase letters, digits or -' : 'This code is not available'}</span>
      : 'Your login code, e.g. city-care';

  return (
    <form onSubmit={handleSubmit((v) => signup.mutate(v))} noValidate className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Start your free trial</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Already registered?{' '}
          <Link href="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
      {signup.error && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {errorMessage(signup.error)}
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="hospitalName" label="Hospital or clinic name" error={errors.hospitalName} className="sm:col-span-2">
          <Input id="hospitalName" maxLength={120} aria-invalid={!!errors.hospitalName} {...register('hospitalName')} />
        </Field>
        <Field id="code" label="Hospital code" error={errors.code} hint={codeHint}>
          <Input id="code" className="font-mono" maxLength={31} autoCapitalize="none" aria-invalid={!!errors.code} {...register('code')} />
        </Field>
        <Field id="facilityType" label="Type">
          <Select id="facilityType" {...register('facilityType')}>
            <option value="hospital">Hospital / nursing home</option>
            <option value="clinic">Clinic</option>
            <option value="diagnostic_centre">Diagnostic centre</option>
            <option value="pharmacy">Pharmacy</option>
          </Select>
        </Field>
        <Field id="city" label="City" error={errors.city}>
          <Input id="city" maxLength={80} {...register('city', { setValueAs: (v: string) => v || undefined })} />
        </Field>
        <Field id="state" label="State" error={errors.state}>
          <Input id="state" maxLength={80} {...register('state', { setValueAs: (v: string) => v || undefined })} />
        </Field>
        <Field id="adminName" label="Your name" error={errors.adminName}>
          <Input id="adminName" maxLength={100} autoComplete="name" aria-invalid={!!errors.adminName} {...register('adminName')} />
        </Field>
        <Field id="mobile" label="Mobile" error={errors.mobile}>
          <Input id="mobile" type="tel" inputMode="numeric" maxLength={14} autoComplete="tel" aria-invalid={!!errors.mobile} {...register('mobile')} />
        </Field>
        <Field id="email" label="Email" error={errors.email}>
          <Input id="email" type="email" maxLength={254} autoComplete="email" aria-invalid={!!errors.email} {...register('email')} />
        </Field>
        <Field id="password" label="Password" error={errors.password} hint="At least 8 characters with a letter and a number">
          <Input id="password" type="password" autoComplete="new-password" maxLength={200} aria-invalid={!!errors.password} {...register('password')} />
        </Field>
        <Field id="planCode" label="Plan" error={errors.planCode} className="sm:col-span-2">
          <Select id="planCode" {...register('planCode')}>
            {plans.data
              ?.filter((p) => p.priceMonthly !== null)
              .map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name} · {inr(p.priceMonthly)}/month after a {p.trialDays}-day trial
                </option>
              ))}
          </Select>
        </Field>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" {...register('acceptTerms')} />
        <span>I agree to the terms of service and the data processing terms.</span>
      </label>
      <FieldError error={errors.acceptTerms} />

      <Button type="submit" className="w-full" size="lg" disabled={signup.isPending}>
        {signup.isPending && <Loader2 className="animate-spin" />} Create my hospital
      </Button>
    </form>
  );
}
