'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { loginRequestSchema } from '@hms/shared';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/field-error';

const RESERVED = new Set(['www', 'app', 'localhost']);

/** `<code>.example.com` -> `code`; plain hosts and IPs give ''. */
function tenantFromHost(host: string): string {
  if (/^[\d.]+$/.test(host) || !host.includes('.')) return '';
  const sub = host.split('.')[0] ?? '';
  return RESERVED.has(sub) ? '' : sub;
}

function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
}

export function LoginForm() {
  const { login, status } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [error, setError] = React.useState<string | null>(null);

  const form = useForm({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { tenantCode: '', identifier: '', password: '', client: 'web' },
  });
  const { register, handleSubmit, setValue, getValues, formState } = form;
  const { errors, isSubmitting } = formState;

  React.useEffect(() => {
    const code = tenantFromHost(window.location.hostname);
    if (code && !getValues('tenantCode')) setValue('tenantCode', code);
  }, [getValues, setValue]);

  React.useEffect(() => {
    if (status === 'authenticated') router.replace(next);
  }, [status, router, next]);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await login(values);
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
      {error && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="tenantCode">Hospital code</Label>
        <Input id="tenantCode" autoCapitalize="none" autoComplete="organization" placeholder="e.g. demo" maxLength={63} aria-invalid={!!errors.tenantCode} {...register('tenantCode')} />
        <FieldError error={errors.tenantCode} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="identifier">Email or mobile</Label>
        <Input id="identifier" autoCapitalize="none" autoComplete="username" placeholder="you@hospital.in or 10-digit mobile" maxLength={254} aria-invalid={!!errors.identifier} {...register('identifier')} />
        <FieldError error={errors.identifier} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" autoComplete="current-password" maxLength={200} aria-invalid={!!errors.password} {...register('password')} />
        <FieldError error={errors.password} />
      </div>
      <Button type="submit" className="w-full" size="lg" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="animate-spin" />}
        Sign in
      </Button>
    </form>
  );
}
