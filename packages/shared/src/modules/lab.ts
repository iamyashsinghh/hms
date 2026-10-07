import { defineModule } from '../manifest';

/**
 * Laboratory: permissions and API contracts (Zod schemas + types).
 * Owned by the "lab" workstream. Add permissions as 'lab.<resource>.<action>'
 * and grant them to system roles below. Import zod with: import { z } from 'zod';
 */
export const labModule = defineModule({
  key: 'lab',
  name: 'Laboratory',
  permissions: [],
  grants: {},
});
