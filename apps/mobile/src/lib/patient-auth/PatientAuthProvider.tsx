import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { variant } from '@/variants';
import {
  loadPatientProfile,
  patientSignOut,
  refreshPatientToken,
  requestOtp,
  verifyOtp,
  type OtpSent,
  type PatientProfile,
} from './session';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface PatientAuthValue {
  status: Status;
  profile: PatientProfile | null;
  bootError: string | null;
  requestOtp: (tenantCode: string, mobile: string) => Promise<OtpSent>;
  verifyOtp: (tenantCode: string, mobile: string, otp: string, demo: boolean, deviceName?: string) => Promise<void>;
  logout: () => Promise<void>;
  restore: () => Promise<void>;
}

const Ctx = createContext<PatientAuthValue | null>(null);

/** Patient app sign-in state. Inactive (signedOut, no network calls) in the staff apps. */
export function PatientAuthProvider({ children }: { children: ReactNode }) {
  const active = variant.key === 'patient';
  const [status, setStatus] = useState<Status>(active ? 'loading' : 'signedOut');
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const restore = useCallback(async () => {
    setStatus('loading');
    setBootError(null);
    try {
      const token = await refreshPatientToken();
      if (!token) {
        setStatus('signedOut');
        return;
      }
      setProfile(await loadPatientProfile());
      setStatus('signedIn');
    } catch (err) {
      setBootError(err instanceof Error ? err.message : String(err));
      setStatus('signedOut');
    }
  }, []);

  useEffect(() => {
    if (active) void restore();
  }, [active, restore]);

  const value = useMemo<PatientAuthValue>(
    () => ({
      status,
      profile,
      bootError,
      requestOtp,
      verifyOtp: async (tenantCode, mobile, otp, demo, deviceName) => {
        setProfile(await verifyOtp(tenantCode, mobile, otp, demo, deviceName));
        setBootError(null);
        setStatus('signedIn');
      },
      logout: async () => {
        await patientSignOut();
        setProfile(null);
        setStatus('signedOut');
      },
      restore,
    }),
    [status, profile, bootError, restore],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePatientAuth(): PatientAuthValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePatientAuth must be used inside <PatientAuthProvider>');
  return ctx;
}
