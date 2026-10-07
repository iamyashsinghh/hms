import { createApiClient, ApiError } from '@hms/api-client';

const FACILITY_KEY = 'hms.facilityId';

// The access token lives in memory only; the refresh token is an httpOnly cookie.
let accessToken: string | null = null;
let facilityId: string | null = null;
let onSessionEnded: (() => void) | null = null;

export const tokenStore = {
  get: () => accessToken,
  set: (t: string | null) => {
    accessToken = t;
  },
};

export const facilityStore = {
  get: () => facilityId,
  set: (id: string | null) => {
    facilityId = id;
    try {
      if (id) localStorage.setItem(FACILITY_KEY, id);
      else localStorage.removeItem(FACILITY_KEY);
    } catch {}
  },
  stored: (): string | null => {
    try {
      return localStorage.getItem(FACILITY_KEY);
    } catch {
      return null;
    }
  },
};

/** Called when a refresh fails, i.e. the session is over. */
export function setSessionEndedHandler(fn: (() => void) | null) {
  onSessionEnded = fn;
}

/** Exchanges the refresh cookie for a new access token (null if there is no session). */
export async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await api.auth.refresh({ client: 'web' });
    accessToken = res.accessToken;
    return accessToken;
  } catch {
    accessToken = null;
    onSessionEnded?.();
    return null;
  }
}

export const api = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? '/api/v1',
  credentials: 'include',
  getAccessToken: () => accessToken,
  getFacilityId: () => facilityId,
  refresh: refreshAccessToken,
});

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}

export { ApiError };
