import { ApiError, createApiClient } from '@hms/api-client';
import type { LoginRequest, LoginResponse } from '@hms/shared';
import { API_URL } from '../config';
import { tokenStore } from './token-store';

/**
 * Session state outside React so the API client can read the access token and rotate the
 * refresh token without re-rendering. AuthProvider subscribes to session-end events.
 */
let accessToken: string | null = null;
let facilityId: string | null = null;
let refreshing: Promise<string | null> | null = null;
const endListeners = new Set<() => void>();

export const session = {
  getAccessToken: () => accessToken,
  setFacilityId: (id: string | null) => {
    facilityId = id;
  },
  getFacilityId: () => facilityId,
  /** Called when the refresh token is rejected (expired, revoked or rotated elsewhere). */
  onEnded(fn: () => void) {
    endListeners.add(fn);
    return () => endListeners.delete(fn);
  },
};

export const api = createApiClient({
  baseUrl: API_URL,
  getAccessToken: () => accessToken,
  getFacilityId: () => facilityId,
  refresh: () => refreshAccessToken(),
});

async function endSession() {
  accessToken = null;
  facilityId = null;
  await tokenStore.clearRefreshToken();
  endListeners.forEach((fn) => fn());
}

/**
 * Exchanges the stored refresh token for a new access token. The server rotates refresh tokens:
 * the old one is invalid after this call, so the new one is saved before anything else happens.
 * Single-flight: concurrent callers share one request (a second refresh with the same token
 * would be treated as reuse). Returns null when there is no session; throws on network errors
 * so an offline start does not log the user out.
 */
export function refreshAccessToken(): Promise<string | null> {
  refreshing ??= (async () => {
    const refreshToken = await tokenStore.getRefreshToken();
    if (!refreshToken) {
      accessToken = null;
      return null;
    }
    try {
      const tokens = await api.auth.refresh({ refreshToken, client: 'mobile' });
      if (tokens.refreshToken) await tokenStore.setRefreshToken(tokens.refreshToken);
      accessToken = tokens.accessToken;
      return accessToken;
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        await endSession();
        return null;
      }
      throw err;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function signIn(body: Omit<LoginRequest, 'client'>): Promise<LoginResponse> {
  const res = await api.auth.login({ ...body, client: 'mobile' });
  if (!res.refreshToken) throw new Error('Server did not return a refresh token for the mobile client');
  await tokenStore.setRefreshToken(res.refreshToken);
  accessToken = res.accessToken;
  return res;
}

export async function signOut(): Promise<void> {
  const refreshToken = await tokenStore.getRefreshToken();
  try {
    if (refreshToken) await api.auth.logout({ refreshToken });
  } catch {
    // Best effort: the local session is cleared regardless.
  } finally {
    accessToken = null;
    facilityId = null;
    await tokenStore.clearRefreshToken();
  }
}
