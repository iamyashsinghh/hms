import { defineModule } from '../manifest';

/**
 * Facility Services: permissions and API contracts (Zod schemas + types).
 * Owned by the "ops" workstream. Add permissions as 'ops.<resource>.<action>'
 * and grant them to system roles below. Import zod with: import { z } from 'zod';
 */
export const opsModule = defineModule({
  key: 'ops',
  name: 'Facility Services',
  permissions: [],
  grants: {},
});
