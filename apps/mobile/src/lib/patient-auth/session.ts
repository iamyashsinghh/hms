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
}

interface VerifyResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  patient?: Partial<PatientProfile> & { firstName?: string; lastName?: string };
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

export function profileFrom(raw: unknown, fallbackMobile: string): PatientProfile {
  const o = (raw ?? {}) as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name : [o.firstName, o.lastName].filter((x) => typeof x === 'string' && x).join(' ');
  return {
    id: typeof o.id === 'string' ? o.id : '',
    name: name || 'Patient',
    mobile: typeof o.mobile === 'string' ? o.mobile : fallbackMobile,
    hospitalName: typeof o.hospitalName === 'string' ? o.hospitalName : typeof o.tenantName === 'string' ? o.tenantName : null,
  };
}

/** Sends the OTP. Returns 'demo' when the portal module is not on the server and demo data is allowed. */
export async function requestOtp(tenantCode: string, mobile: string): Promise<'sent' | 'demo'> {
  try {
    await patientHttp.request('POST', ENDPOINTS.portal.otpRequest, { body: { tenantCode, mobile }, auth: false });
    return 'sent';
  } catch (err) {
    if (isMissingRoute(err) && DEMO_FALLBACK) return 'demo';
    if (isMissingRoute(err)) throw new Error('Patient login is not available on this server yet');
    throw err;
  }
}

export async function verifyOtp(tenantCode: string, mobile: string, otp: string, demoMode: boolean): Promise<PatientProfile> {
  if (demoMode) {
    if (otp !== DEMO_OTP) throw new ApiError(401, 'invalid_otp', 'Wrong OTP');
    demo = true;
    accessToken = null;
    await SecureStore.setItemAsync(TENANT_KEY, tenantCode);
    return { id: 'demo-patient', name: 'Demo Patient', mobile, hospitalName: tenantCode };
  }
  const res = await patientHttp.request<VerifyResponse>('POST', ENDPOINTS.portal.otpVerify, {
    body: { tenantCode, mobile, otp, client: 'mobile' },
    auth: false,
  });
  if (!res.refreshToken) throw new Error('Server did not return a refresh token for the mobile client');
  demo = false;
  accessToken = res.accessToken;
  await SecureStore.setItemAsync(REFRESH_KEY, res.refreshToken);
  await SecureStore.setItemAsync(TENANT_KEY, tenantCode);
  return profileFrom(res.patient, mobile);
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
