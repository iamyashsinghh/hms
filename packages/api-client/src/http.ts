import type { ApiErrorBody, AuthTokens } from '@hms/shared';
import { FACILITY_HEADER } from '@hms/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Query parameters; undefined/null/empty values are dropped. */
export type Query = object;

export interface HttpOptions {
  /** e.g. `http://localhost:4000/api/v1` or `/api/v1` behind the Next.js proxy. */
  baseUrl: string;
  /** Current access token, if any. */
  getAccessToken: () => string | null | undefined;
  /** Facility the user is working in (sent as X-Facility-Id). */
  getFacilityId?: () => string | null | undefined;
  /**
   * Called once on a 401. Should refresh and return the new access token (or null if the
   * session is over). The failed request is retried once with the new token.
   */
  refresh?: () => Promise<string | null>;
  /** 'include' for the web app so the refresh cookie is sent. */
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
}

export interface Http {
  request<T>(method: string, path: string, opts?: { body?: unknown; query?: Query; auth?: boolean }): Promise<T>;
  get<T>(path: string, query?: Query): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

function buildUrl(base: string, path: string, query?: Query): string {
  let url = base.replace(/\/$/, '') + path;
  if (query) {
    const qs = Object.entries(query as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    if (qs) url += `?${qs}`;
  }
  return url;
}

export function createHttp(opts: HttpOptions): Http {
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  let refreshing: Promise<string | null> | null = null;

  async function send<T>(method: string, path: string, body: unknown, query: Query | undefined, auth: boolean, retried: boolean): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const token = auth ? opts.getAccessToken() : null;
    if (token) headers.authorization = `Bearer ${token}`;
    const facility = opts.getFacilityId?.();
    if (facility) headers[FACILITY_HEADER] = facility;

    const res = await doFetch(buildUrl(opts.baseUrl, path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: opts.credentials,
    });

    if (res.status === 401 && auth && !retried && opts.refresh) {
      refreshing ??= opts.refresh().finally(() => (refreshing = null));
      const next = await refreshing;
      if (next) return send<T>(method, path, body, query, auth, true);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const err = (data as ApiErrorBody | undefined)?.error;
      throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? res.statusText, err?.details);
    }
    return data as T;
  }

  const request = <T>(method: string, path: string, o: { body?: unknown; query?: Query; auth?: boolean } = {}) =>
    send<T>(method, path, o.body, o.query, o.auth ?? true, false);

  return {
    request,
    get: (p, q) => request('GET', p, { query: q }),
    post: (p, b) => request('POST', p, { body: b ?? {} }),
    patch: (p, b) => request('PATCH', p, { body: b ?? {} }),
    put: (p, b) => request('PUT', p, { body: b ?? {} }),
    delete: (p) => request('DELETE', p),
  };
}

export type { AuthTokens };
