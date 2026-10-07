import { randomUUID } from 'node:crypto';
import { emptyContext, requestContext, type RequestContext } from '../../common/context/request-context';

/**
 * Runs `fn` as a hospital with no signed-in user: for outbox event handlers in the worker. Other
 * modules' services (PatientsService, BillingService) read the tenant from the request context.
 */
export function runAsTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  const ctx: RequestContext = { ...emptyContext(`integrations-${randomUUID()}`), tenantId, facilityIds: 'all' };
  return requestContext.run(ctx, fn);
}

/**
 * Public callbacks (ABDM, payment gateways) and API-key calls carry the hospital in the URL or key,
 * not in a staff token. The request context object is the one ContextInterceptor already runs the
 * handler in, so filling it here scopes every later DbService.tx() to that hospital.
 */
export function bindTenant(ctx: RequestContext, tenantId: string, facilityId: string | null = null): void {
  ctx.tenantId = tenantId;
  ctx.facilityIds = 'all';
  ctx.facilityId = facilityId;
}

/** Today's date in India (YYYY-MM-DD). */
export const istToday = (at = new Date()) => new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);
