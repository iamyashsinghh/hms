'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { portal } from '@hms/shared';
import { errorMessage } from '@/lib/api';
import { firstError, validate } from '@/lib/validate';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { patientApi, usePatientSession } from '@/modules/portal/patient-session';

function PatientLogin() {
  const { status, signIn } = usePatientSession();
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = React.useState<'mobile' | 'otp'>('mobile');
  const [tenantCode, setTenantCode] = React.useState(params.get('h') ?? '');
  const [mobile, setMobile] = React.useState('');
  const [otp, setOtp] = React.useState('');
  const [hint, setHint] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (status === 'authenticated') router.replace('/p/home');
  }, [status, router]);

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    const check = validate(portal.otpRequestSchema, { tenantCode, mobile });
    if (check.errors) return setError(firstError(check.errors));
    setBusy(true);
    try {
      const res = await patientApi.portal.auth.requestOtp({ tenantCode, mobile });
      setHint(
        res.devCode
          ? `Test mode: your code is ${res.devCode}`
          : `We sent a 6-digit code to ${mobile}`,
      );
      setStep('otp');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const check = validate(portal.otpVerifySchema, { tenantCode, mobile, otp });
    if (check.errors) return setError(firstError(check.errors));
    setBusy(true);
    try {
      await signIn({ tenantCode, mobile, otp });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-secondary via-background to-accent/10 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex items-center gap-3">
            <Logo />
            <span className="font-semibold">Patient portal</span>
          </div>
          <CardTitle className="text-xl">
            {step === 'mobile' ? 'Sign in with your mobile' : 'Enter the code'}
          </CardTitle>
          <CardDescription>
            {step === 'mobile'
              ? 'Book appointments, see prescriptions and pay bills online.'
              : hint}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          )}
          {step === 'mobile' ? (
            <form onSubmit={sendCode} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="tenantCode">Hospital code</Label>
                <Input
                  id="tenantCode"
                  autoCapitalize="none"
                  maxLength={63}
                  placeholder="e.g. demo"
                  value={tenantCode}
                  onChange={(e) => setTenantCode(e.target.value.trim())}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mobile">Mobile number</Label>
                <Input
                  id="mobile"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  maxLength={10}
                  placeholder="98XXXXXXXX"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
                />
              </div>
              <Button type="submit" className="w-full" size="lg" disabled={busy || !tenantCode}>
                {busy && <Loader2 className="animate-spin" />} Send code
              </Button>
            </form>
          ) : (
            <form onSubmit={verify} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="otp">6-digit code</Label>
                <Input
                  id="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  autoFocus
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={busy || otp.length !== 6}
              >
                {busy && <Loader2 className="animate-spin" />} Verify and sign in
              </Button>
              <div className="flex justify-between text-sm">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  onClick={() => setStep('mobile')}
                >
                  <ArrowLeft className="size-3" /> Change number
                </button>
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => sendCode()}
                  disabled={busy}
                >
                  Resend code
                </button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function PatientLoginPage() {
  return (
    <React.Suspense>
      <PatientLogin />
    </React.Suspense>
  );
}
