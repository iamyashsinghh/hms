import { defineModule } from '../manifest';

/**
 * Hospital Setup: permissions and API contracts (Zod schemas + types).
 * Owned by the "setup" workstream. Add permissions as 'setup.<resource>.<action>'
 * and grant them to system roles below. Import zod with: import { z } from 'zod';
 */
export const setupModule = defineModule({
  key: 'setup',
  name: 'Hospital Setup',
  permissions: [],
  grants: {},
});
