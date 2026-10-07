'use client';

import * as React from 'react';
import { Building2, ChevronDown, LogOut, Menu } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function Header({ onMenu }: { onMenu: () => void }) {
  const { user, facility, setFacility, logout } = useAuth();
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!user) return null;

  async function onLogout() {
    setOpen(false);
    await logout(); // the (app) guard redirects to /login
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur sm:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="Open navigation">
        <Menu />
      </Button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold sm:text-base">{user.tenantName}</p>
        <p className="hidden text-xs text-muted-foreground sm:block">Hospital code: {user.tenantCode}</p>
      </div>

      {user.facilities.length > 0 && (
        <label className="flex items-center gap-2">
          <Building2 className="hidden size-4 text-muted-foreground sm:block" />
          <span className="sr-only">Facility</span>
          <Select
            className="h-8 w-36 sm:w-52"
            value={facility?.id ?? ''}
            onChange={(e) => setFacility(e.target.value)}
            disabled={user.facilities.length < 2}
          >
            {user.facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </label>
      )}

      <div className="relative" ref={menuRef}>
        <button
          className="flex items-center gap-2 rounded-full p-1 pr-2 hover:bg-muted"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-primary">
            {initials(user.name)}
          </span>
          <span className="hidden text-sm font-medium md:block">{user.name}</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </button>
        {open && (
          <div role="menu" className="absolute right-0 mt-2 w-60 rounded-lg border bg-card p-1 shadow-lg">
            <div className="px-3 py-2">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email ?? user.mobile}</p>
            </div>
            <div className="my-1 h-px bg-border" />
            <button
              role="menuitem"
              onClick={onLogout}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive hover:bg-muted"
            >
              <LogOut className="size-4" /> Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
