import { defineModule } from '../manifest';

/**
 * IPD & Nursing: permissions and API contracts (Zod schemas + types).
 * Owned by the "ipd" workstream. Add permissions as 'ipd.<resource>.<action>'
 * and grant them to system roles below. Import zod with: import { z } from 'zod';
 */
export const ipdModule = defineModule({
  key: 'ipd',
  name: 'IPD & Nursing',
  permissions: [],
  grants: {},
});
