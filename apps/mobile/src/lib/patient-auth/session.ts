import { ApiError, createHttp } from '@hms/api-client';
import * as SecureStore from 'expo-secure-store';
import { isMissingRoute } from '@/data/client';
import { ENDPOINTS } from '@/data/endpoints';
import { API_URL } from '../config';
import { DEMO_FALLBACK } from '../data';

/**
 * Patient app session (typ:'patient' JWT from the portal module's OTP login), kept apart from the
 * staff session: its own refresh token in the keychain, its own HTTP client.
 */
const REFRESH_KEY = 'hms.patient.refreshToken';
const TENANT_KEY = 'hms.patient.tenantCode';
/** OTP accepted by the demo session in development while the portal module is not on the server. */
export const DEMO_OTP = '123456';

export interface PatientProfile {
  id: string;
  name: string;
  mobile: string;
  hospitalName: string | null;
  /** Patient records linked to this account at this hospital (self and family). */
  members: { id: string; name: string; uhid: string; relation: string }[];
}

interface VerifyResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  /** PortalMe: account, hospital and linked patients (self + family). */
  me?: unknown;
}

let accessToken: string | null = null;
let refreshing: Promise<string | null> | null = null;
let demo = false;

export const patientHttp = createHttp({
  baseUrl: API_URL,
  getAccessToken: () => accessToken,
  refresh: () => refreshPatientToken(),
});

export const patientSession = {
  isDemo: () => demo,
  getTenantCode: () => SecureStore.getItemAsync(TENANT_KEY),
};

/** Maps GET /portal/me (PortalMe) to the profile the app shows. */
export function profileFrom(raw: unknown, fallbackMobile: string): PatientProfile {
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const patients = Array.isArray(o.patients) ? (o.patients as Record<string, unknown>[]) : [];
  const self = patients.find((p) => p.relation === 'self') ?? patients[0];
  const selfName = self ? [str(self.firstName), str(self.lastName)].filter(Boolean).join(' ') : '';
  return {
    id: str(o.accountId) ?? str(o.id) ?? '',
    name: str(o.name) ?? (selfName || 'Patient'),
    mobile: str(o.mobile) ?? fallbackMobile,
    hospitalName: str(o.hospitalName) ?? str(o.tenantName),
    members: patients.flatMap((p) => {
      const id = str(p.id);
      return id ? [{ id, name: [str(p.firstName), str(p.lastName)].filter(Boolean).join(' '), uhid: str(p.uhid) ?? '', relation: str(p.relation) ?? 'other' }] : [];
    }),
  };
}

export type OtpSent = { mode: 'sent'; devCode?: string } | { mode: 'demo' };

/**
 * Sends the OTP. `devCode` is returned only by non-production servers with the mock SMS provider.
 * Returns demo mode when the portal module is not on the server and demo data is allowed.
 */
export async function requestOtp(tenantCode: string, mobile: string): Promise<OtpSent> {
  try {
    const res = await patientHttp.request<{ devCode?: string } | undefined>('POST', ENDPOINTS.portal.otpRequest, {
      body: { tenantCode, mobile },
      auth: false,
    });
    return { mode: 'sent', ...(res?.devCode ? { devCode: res.devCode } : {}) };
  } catch (err) {
    if (isMissingRoute(err) && DEMO_FALLBACK) return { mode: 'demo' };
    if (isMissingRoute(err)) throw new Error('Patient login is not available on this server yet');
    throw err;
  }
}

export async function verifyOtp(
  tenantCode: string,
  mobile: string,
  otp: string,
  demoMode: boolean,
  deviceName?: string,
): Promise<PatientProfile> {
  if (demoMode) {
    if (otp !== DEMO_OTP) throw new ApiError(401, 'invalid_otp', 'Wrong OTP');
    demo = true;
    accessToken = null;
    await SecureStore.setItemAsync(TENANT_KEY, tenantCode);
    return { id: 'demo-patient', name: 'Demo Patient', mobile, hospitalName: tenantCode, members: [] };
  }
  const res = await patientHttp.request<VerifyResponse>('POST', ENDPOINTS.portal.otpVerify, {
    body: { tenantCode, mobile, otp, client: 'mobile', ...(deviceName ? { deviceName } : {}) },
    auth: false,
  });
  if (!res.refreshToken) throw new Error('Server did not return a refresh token for the mobile client');
  demo = false;
  accessToken = res.accessToken;
  await SecureStore.setItemAsync(REFRESH_KEY, res.refreshToken);
  await SecureStore.setItemAsync(TENANT_KEY, tenantCode);
  return profileFrom(res.me, mobile);
}

/** Same single-flight rotation as the staff session (see lib/auth/session.ts). */
export function refreshPatientToken(): Promise<string | null> {
  refreshing ??= (async () => {
    const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
    if (!refreshToken) {
      accessToken = null;
      return null;
    }
    try {
      const tokens = await patientHttp.request<VerifyResponse>('POST', ENDPOINTS.portal.refresh, {
        body: { refreshToken, client: 'mobile' },
        auth: false,
      });
      if (tokens.refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken);
      accessToken = tokens.accessToken;
      return accessToken;
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        accessToken = null;
        await SecureStore.deleteItemAsync(REFRESH_KEY);
        return null;
      }
      throw err;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function loadPatientProfile(): Promise<PatientProfile> {
  return profileFrom(await patientHttp.get(ENDPOINTS.portal.me), '');
}

export async function patientSignOut(): Promise<void> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
  try {
    if (refreshToken && !demo) await patientHttp.request('POST', ENDPOINTS.portal.logout, { body: { refreshToken }, auth: false });
  } catch {
    // Best effort: the local session is cleared regardless.
  } finally {
    accessToken = null;
    demo = false;
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  }
}
