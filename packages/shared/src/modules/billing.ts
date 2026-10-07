import { defineModule } from '../manifest';

/**
 * Billing: permissions and API contracts (Zod schemas + types).
 * Owned by the "billing" workstream. Add permissions as 'billing.<resource>.<action>'
 * and grant them to system roles below. Import zod with: import { z } from 'zod';
 */
export const billingModule = defineModule({
  key: 'billing',
  name: 'Billing',
  permissions: [],
  grants: {},
});
