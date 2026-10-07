import { emptyContext, requestContext, type RequestContext } from '../../common/context/request-context';

/**
 * Runs `fn` with `tenantId` in the request context, so services that use DbService.tx()
 * (e.g. PatientsService) work for public OTP routes and for event handlers in the worker.
 */
export function runAsTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  const parent = requestContext.getStore();
  const ctx: RequestContext = { ...(parent ?? emptyContext('portal')), tenantId, userId: undefined, facilityId: null };
  return requestContext.run(ctx, fn);
}
