import type { Metadata } from 'next';
import { Logo } from '@/components/logo';
import { SignupForm } from './signup-form';

export const metadata: Metadata = { title: 'Start your free trial' };

/** Public hospital signup. Owned by the "platform" workstream. */
export default function SignupPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-5">
      <div className="relative hidden flex-col justify-between bg-gradient-to-br from-sidebar via-blue-900 to-teal-800 p-10 text-white lg:col-span-2 lg:flex">
        <div className="flex items-center gap-3">
          <Logo className="bg-white/15 bg-none" />
          <span className="text-lg font-semibold">HMS</span>
        </div>
        <div className="max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">Run your hospital from day one.</h2>
          <ul className="mt-4 space-y-2 text-blue-100/90">
            <li>14-day free trial, no card needed</li>
            <li>OPD, billing, pharmacy and patient portal</li>
            <li>Your data stays private to your hospital</li>
          </ul>
        </div>
        <p className="text-xs text-blue-100/60">© HMS</p>
      </div>
      <div className="flex items-center justify-center p-6 lg:col-span-3">
        <div className="w-full max-w-xl">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo />
            <span className="text-lg font-semibold">HMS</span>
          </div>
          <SignupForm />
        </div>
      </div>
    </div>
  );
}
