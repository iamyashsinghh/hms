'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createApiClient } from '@hms/api-client';
import type { portal } from '@hms/shared';

// Patient session for the public portal (/p). Separate from the staff session: its own in-memory
// access token and its own httpOnly refresh cookie (path /api/v1/portal/auth).
let accessToken: string | null = null;
let onEnded: (() => void) | null = null;

async function refresh(): Promise<string | null> {
  try {
    const res = await patientApi.portal.auth.refresh({ client: 'web' });
    accessToken = res.accessToken;
    return accessToken;
  } catch {
    accessToken = null;
    onEnded?.();
    return null;
  }
}

export const patientApi = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? '/api/v1',
  credentials: 'include',
  getAccessToken: () => accessToken,
  refresh,
});

type Status = 'loading' | 'authenticated' | 'unauthenticated';

interface PatientSession {
  status: Status;
  me: portal.PortalMe | null;
  signIn: (body: Omit<portal.OtpVerify, 'client'>) => Promise<void>;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
}

const Ctx = React.createContext<PatientSession | null>(null);

let restore: Promise<portal.PortalMe | null> | null = null;
function restoreSession() {
  restore ??= (async () => ((await refresh()) ? patientApi.portal.me().catch(() => null) : null))();
  return restore;
}

export function PatientSessionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState<Status>('loading');
  const [me, setMe] = React.useState<portal.PortalMe | null>(null);

  const ended = React.useCallback(() => {
    accessToken = null;
    setMe(null);
    setStatus('unauthenticated');
    queryClient.removeQueries({ queryKey: ['portal'] });
  }, [queryClient]);

  React.useEffect(() => {
    onEnded = ended;
    return () => {
      onEnded = null;
    };
  }, [ended]);

  React.useEffect(() => {
    let active = true;
    restoreSession().then((m) => {
      if (!active) return;
      setMe(m);
      setStatus(m ? 'authenticated' : 'unauthenticated');
    });
    return () => {
      active = false;
    };
  }, []);

  const signIn = React.useCallback(async (body: Omit<portal.OtpVerify, 'client'>) => {
    const res = await patientApi.portal.auth.verifyOtp({ ...body, client: 'web' });
    accessToken = res.accessToken;
    restore = Promise.resolve(res.me);
    setMe(res.me);
    setStatus('authenticated');
  }, []);

  const signOut = React.useCallback(async () => {
    await patientApi.portal.auth.logout().catch(() => undefined);
    restore = Promise.resolve(null);
    ended();
  }, [ended]);

  const reload = React.useCallback(async () => {
    const m = await patientApi.portal.me();
    restore = Promise.resolve(m);
    setMe(m);
  }, []);

  const value = React.useMemo(() => ({ status, me, signIn, signOut, reload }), [status, me, signIn, signOut, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePatientSession(): PatientSession {
  const v = React.useContext(Ctx);
  if (!v) throw new Error('usePatientSession must be used inside <PatientSessionProvider>');
  return v;
}
