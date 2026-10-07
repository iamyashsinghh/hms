import type { Me } from '@hms/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, refreshAccessToken, session, signIn, signOut } from './session';

type Status = 'loading' | 'signedOut' | 'signedIn';

export interface AuthContextValue {
  status: Status;
  user: Me | null;
  /** Error from restoring the session at start-up (e.g. server unreachable). */
  bootError: string | null;
  facilityId: string | null;
  login: (input: { tenantCode: string; identifier: string; password: string; deviceName?: string }) => Promise<void>;
  logout: () => Promise<void>;
  /** Retry restoring the session after a boot error. */
  restore: () => Promise<void>;
  reloadUser: () => Promise<void>;
  selectFacility: (id: string) => void;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<Me | null>(null);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const applyUser = useCallback((me: Me) => {
    const facility = me.facilities[0]?.id ?? null;
    session.setFacilityId(facility);
    setFacilityId(facility);
    setUser(me);
    setStatus('signedIn');
  }, []);

  const clear = useCallback(() => {
    setUser(null);
    setFacilityId(null);
    setStatus('signedOut');
  }, []);

  const restore = useCallback(async () => {
    setStatus('loading');
    setBootError(null);
    try {
      const token = await refreshAccessToken();
      if (!token) return clear();
      applyUser(await api.auth.me());
    } catch (err) {
      setBootError(err instanceof Error ? err.message : String(err));
      setStatus('signedOut');
    }
  }, [applyUser, clear]);

  useEffect(() => {
    const off = session.onEnded(clear);
    void restore();
    return () => {
      off();
    };
  }, [restore, clear]);

  const login = useCallback<AuthContextValue['login']>(
    async (input) => {
      const res = await signIn(input);
      setBootError(null);
      applyUser(res.user);
    },
    [applyUser],
  );

  const logout = useCallback(async () => {
    await signOut();
    clear();
  }, [clear]);

  const reloadUser = useCallback(async () => {
    const me = await api.auth.me();
    setUser(me);
  }, []);

  const selectFacility = useCallback((id: string) => {
    session.setFacilityId(id);
    setFacilityId(id);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      bootError,
      facilityId,
      login,
      logout,
      restore,
      reloadUser,
      selectFacility,
      can: (permission) => !!user?.permissions.includes(permission),
    }),
    [status, user, bootError, facilityId, login, logout, restore, reloadUser, selectFacility],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
