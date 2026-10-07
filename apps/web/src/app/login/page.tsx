import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LoginForm } from './login-form';
import { Logo } from '@/components/logo';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between bg-gradient-to-br from-sidebar via-blue-900 to-teal-800 p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <Logo className="bg-white/15 bg-none" />
          <span className="text-lg font-semibold">HMS</span>
        </div>
        <div className="max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">Hospital operations, in one place.</h2>
          <p className="mt-3 text-blue-100/80">
            Registration, OPD, IPD, pharmacy, lab and billing for your hospital and all its facilities.
          </p>
        </div>
        <p className="text-xs text-blue-100/60">© HMS</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo />
            <span className="text-lg font-semibold">HMS</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Use your hospital code and staff account.</p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
