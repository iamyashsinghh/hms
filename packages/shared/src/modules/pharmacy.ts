import { defineModule } from '../manifest';

/**
 * Pharmacy: permissions and API contracts (Zod schemas + types).
 * Owned by the "pharmacy" workstream. Add permissions as 'pharmacy.<resource>.<action>'
 * and grant them to system roles below. Import zod with: import { z } from 'zod';
 */
export const pharmacyModule = defineModule({
  key: 'pharmacy',
  name: 'Pharmacy',
  permissions: [],
  grants: {},
});
