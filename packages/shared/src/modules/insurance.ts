import { defineModule } from '../manifest';

/**
 * Insurance & Schemes: permissions and API contracts (Zod schemas + types).
 * Owned by the "insurance" workstream. Add permissions as 'insurance.<resource>.<action>'
 * and grant them to system roles below. Import zod with: import { z } from 'zod';
 */
export const insuranceModule = defineModule({
  key: 'insurance',
  name: 'Insurance & Schemes',
  permissions: [],
  grants: {},
});
