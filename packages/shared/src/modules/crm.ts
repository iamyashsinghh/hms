import { defineModule } from '../manifest';

/**
 * Referral & CRM: permissions and API contracts (Zod schemas + types).
 * Owned by the "crm" workstream. Add permissions as 'crm.<resource>.<action>'
 * and grant them to system roles below. Import zod with: import { z } from 'zod';
 */
export const crmModule = defineModule({
  key: 'crm',
  name: 'Referral & CRM',
  permissions: [],
  grants: {},
});
