'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Database, Loader2, LogOut } from 'lucide-react';
import { platform } from '@hms/shared';
import { errorMessage } from '@/lib/api';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/field-error';
import { cn } from '@/lib/utils';
import { useConsole } from './session';

const LINKS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/tenants', label: 'Hospitals' },
  { href: '/admin/tickets', label: 'Tickets' },
  { href: '/admin/invoices', label: 'Invoices' },
  { href: '/admin/plans', label: 'Plans' },
  { href: '/admin/announcements', label: 'Announcements' },
  { href: '/admin/help', label: 'Help articles' },
  { href: '/admin/users', label: 'Platform users', superOnly: true },
];

function ConsoleLogin() {
  const { login } = useConsole();
  const [error, setError] = React.useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(platform.platformLoginSchema), defaultValues: { email: '', password: '' } });
  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar p-6">
      <form
        noValidate
        className="w-full max-w-sm space-y-5 rounded-xl bg-card p-8 shadow-xl"
        onSubmit={handleSubmit(async (v) => {
          setError(null);
          try {
            await login(v);
          } catch (e) {
            setError(errorMessage(e));
          }
        })}
      >
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <p className="font-semibold">HMS Platform Console</p>
            <p className="text-xs text-muted-foreground">For the HMS team only</p>
          </div>
        </div>
        {error && <p className="rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="username" className="mt-2" {...register('email')} />
          <FieldError error={formState.errors.email} />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="current-password" className="mt-2" {...register('password')} />
          <FieldError error={formState.errors.password} />
        </div>
        <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
          {formState.isSubmitting && <Loader2 className="animate-spin" />} Sign in
        </Button>
      </form>
    </div>
  );
}

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const { admin, ready, logout } = useConsole();
  const pathname = usePathname();
  if (!ready) return null;
  if (!admin) return <ConsoleLogin />;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 bg-sidebar text-sidebar-foreground shadow">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
          <Link href="/admin" className="flex items-center gap-2 font-semibold text-white">
            <Logo className="size-7" /> Console
          </Link>
          <nav className="flex flex-1 gap-1 overflow-x-auto text-sm">
            {LINKS.filter((l) => !l.superOnly || admin.role === 'super_admin').map((l) => {
              const active = l.href === '/admin' ? pathname === '/admin' : pathname.startsWith(l.href);
              return (
                <Link key={l.href} href={l.href} className={cn('whitespace-nowrap rounded-md px-3 py-1.5', active ? 'bg-white/10 text-white' : 'hover:text-white')}>
                  {l.label}
                </Link>
              );
            })}
          </nav>
          {admin.role === 'super_admin' && (
            // Adminer, served by the Docker proxy at /db/; it asks for the Postgres password itself.
            <a
              href="/db/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm hover:text-white"
              title="Database viewer (needs the Postgres password)"
            >
              <Database className="size-4" /> Database
            </a>
          )}
          <span className="hidden text-xs sm:block">
            {admin.name} · {admin.role === 'super_admin' ? 'Super admin' : 'Support'}
          </span>
          <button type="button" onClick={() => logout()} className="rounded p-1.5 hover:bg-white/10" aria-label="Sign out">
            <LogOut className="size-4" />
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
}

export function useIsSuperAdmin() {
  return useConsole().admin?.role === 'super_admin';
}
