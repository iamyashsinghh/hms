'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Facility, LoginRequest, Me } from '@hms/shared';
import { api, facilityStore, refreshAccessToken, setSessionEndedHandler, tokenStore } from '@/lib/api';

type Status = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: Status;
  user: Me | null;
  facility: Facility | null;
  setFacility: (id: string) => void;
  login: (body: LoginRequest) => Promise<Me>;
  logout: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

function pickFacility(user: Me): Facility | null {
  const stored = facilityStore.stored();
  return user.facilities.find((f) => f.id === stored) ?? user.facilities[0] ?? null;
}

// One restore per page load (React StrictMode runs effects twice in dev, and the
// refresh token rotates, so a second concurrent refresh would be rejected).
let restorePromise: Promise<Me | null> | null = null;
function restoreSession(): Promise<Me | null> {
  restorePromise ??= (async () => {
    const token = await refreshAccessToken();
    if (!token) return null;
    try {
      return await api.auth.me();
    } catch {
      return null;
    }
  })();
  return restorePromise;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState<Status>('loading');
  const [user, setUser] = React.useState<Me | null>(null);
  const [facility, setFacilityState] = React.useState<Facility | null>(null);

  const signIn = React.useCallback((me: Me) => {
    const f = pickFacility(me);
    facilityStore.set(f?.id ?? null);
    setFacilityState(f);
    setUser(me);
    setStatus('authenticated');
  }, []);

  const signOut = React.useCallback(() => {
    tokenStore.set(null);
    setUser(null);
    setFacilityState(null);
    setStatus('unauthenticated');
    queryClient.clear();
  }, [queryClient]);

  React.useEffect(() => {
    let active = true;
    restoreSession().then((me) => {
      if (!active) return;
      if (me) signIn(me);
      else setStatus('unauthenticated');
    });
    return () => {
      active = false;
    };
  }, [signIn]);

  React.useEffect(() => {
    setSessionEndedHandler(signOut);
    return () => setSessionEndedHandler(null);
  }, [signOut]);

  const login = React.useCallback(
    async (body: LoginRequest) => {
      const res = await api.auth.login({ ...body, client: 'web' });
      tokenStore.set(res.accessToken);
      restorePromise = Promise.resolve(res.user);
      queryClient.clear();
      signIn(res.user);
      return res.user;
    },
    [queryClient, signIn],
  );

  const logout = React.useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      // The session is cleared locally either way.
    }
    restorePromise = Promise.resolve(null);
    signOut();
  }, [signOut]);

  const setFacility = React.useCallback(
    (id: string) => {
      const f = user?.facilities.find((x) => x.id === id);
      if (!f) return;
      facilityStore.set(f.id);
      setFacilityState(f);
      // Facility-scoped data must be refetched.
      queryClient.invalidateQueries();
    },
    [user, queryClient],
  );

  const value = React.useMemo(
    () => ({ status, user, facility, setFacility, login, logout }),
    [status, user, facility, setFacility, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
