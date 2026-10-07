import { defineModule } from '../manifest';

/**
 * SaaS Platform: permissions and API contracts (Zod schemas + types).
 * Owned by the "platform" workstream. Add permissions as 'platform.<resource>.<action>'
 * and grant them to system roles below. Import zod with: import { z } from 'zod';
 */
export const platformModule = defineModule({
  key: 'platform',
  name: 'SaaS Platform',
  permissions: [],
  grants: {},
});
