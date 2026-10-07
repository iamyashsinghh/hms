import { defineModule } from '../manifest';

/**
 * HR & Roster: permissions and API contracts (Zod schemas + types).
 * Owned by the "hr" workstream. Add permissions as 'hr.<resource>.<action>'
 * and grant them to system roles below. Import zod with: import { z } from 'zod';
 */
export const hrModule = defineModule({
  key: 'hr',
  name: 'HR & Roster',
  permissions: [],
  grants: {},
});
