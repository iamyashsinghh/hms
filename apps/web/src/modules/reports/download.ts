import type { reports } from '@hms/shared';
import { api, ApiError, facilityStore, refreshAccessToken, tokenStore } from '@/lib/api';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api/v1';

/** Downloads a CSV export with the signed-in user's token (the JSON client can't read text/csv). */
export async function downloadCsv(q: reports.ExportQuery): Promise<void> {
  const url = BASE.replace(/\/$/, '') + api.reports.exportPath(q);
  const send = () => {
    const headers: Record<string, string> = { accept: 'text/csv' };
    const token = tokenStore.get();
    if (token) headers.authorization = `Bearer ${token}`;
    const facility = facilityStore.get();
    if (facility) headers['x-facility-id'] = facility;
    return fetch(url, { headers, credentials: 'include' });
  };
  let res = await send();
  if (res.status === 401 && (await refreshAccessToken())) res = await send();
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error?.code ?? 'http_error', body?.error?.message ?? res.statusText);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `${q.report}.csv`;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
