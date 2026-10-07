import { AsyncLocalStorage } from 'node:async_hooks';

/** Who is calling and for which hospital. Filled by the auth guard, read by DbService. */
export interface RequestContext {
  requestId: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  facilityId?: string | null;
  roles: string[];
  permissions: Set<string>;
  /** 'all' when a role is not limited to specific facilities. */
  facilityIds: string[] | 'all';
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function currentContext(): RequestContext | undefined {
  return requestContext.getStore();
}

export function emptyContext(requestId: string): RequestContext {
  return { requestId, roles: [], permissions: new Set(), facilityIds: [] };
}
