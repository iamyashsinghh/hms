import { defineModule } from '../manifest';

/**
 * Reports & MIS: permissions and API contracts (Zod schemas + types).
 * Owned by the "reports" workstream. Add permissions as 'reports.<resource>.<action>'
 * and grant them to system roles below. Import zod with: import { z } from 'zod';
 */
export const reportsModule = defineModule({
  key: 'reports',
  name: 'Reports & MIS',
  permissions: [],
  grants: {},
});
