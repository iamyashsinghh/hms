'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, createHttp } from '@hms/api-client';
import type { platform as P } from '@hms/shared';
import { api } from '@/lib/api';

const KEY = 'hms.platformAdmin';

interface Stored {
  token: string;
  admin: P.PlatformAdmin;
  expiresAt: number;
}

function read(): Stored | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as Stored) : null;
    return s && s.expiresAt > Date.now() ? s : null;
  } catch {
    return null;
  }
}

let token: string | null = null;

// Tiny external store so the session is read from sessionStorage on the client only (no hydration mismatch).
let current: Stored | null | undefined;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => {
  if (current === undefined) {
    current = read();
    token = current?.token ?? null;
  }
  return current;
};
function setSession(s: Stored | null) {
  current = s;
  token = s?.token ?? null;
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {}
  listeners.forEach((l) => l());
}

// Platform-admin tokens live in sessionStorage (cleared when the tab closes) and never touch the staff session.
const http = createHttp({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? '/api/v1',
  getAccessToken: () => token,
  refresh: async () => {
    setSession(null);
    return null;
  },
});

export const consoleApi = api.platform.console(http);

interface ConsoleSession {
  admin: P.PlatformAdmin | null;
  ready: boolean;
  login: (body: P.PlatformLogin) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = React.createContext<ConsoleSession | null>(null);

/**
 * The console gets its own query cache: the staff session (AuthProvider) clears the shared cache
 * when it finds no staff login, which would drop console queries mid-flight.
 */
export function ConsoleSessionProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 },
        },
      }),
  );
  const session = React.useSyncExternalStore(subscribe, snapshot, () => undefined);

  const login = React.useCallback(async (body: P.PlatformLogin) => {
    const res = await consoleApi.login(body);
    setSession({ token: res.accessToken, admin: res.admin, expiresAt: Date.now() + res.expiresIn * 1000 });
  }, []);

  const logout = React.useCallback(async () => {
    try {
      await consoleApi.logout();
    } catch {}
    setSession(null);
    queryClient.clear();
  }, [queryClient]);

  const value = React.useMemo(
    () => ({ admin: session?.admin ?? null, ready: session !== undefined, login, logout }),
    [session, login, logout],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <Ctx.Provider value={value}>{children}</Ctx.Provider>
    </QueryClientProvider>
  );
}

export function useConsole(): ConsoleSession {
  const v = React.useContext(Ctx);
  if (!v) throw new Error('useConsole must be used inside <ConsoleSessionProvider>');
  return v;
}
