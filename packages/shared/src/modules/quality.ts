import { defineModule } from '../manifest';

/**
 * Quality & NABH: permissions and API contracts (Zod schemas + types).
 * Owned by the "quality" workstream. Add permissions as 'quality.<resource>.<action>'
 * and grant them to system roles below. Import zod with: import { z } from 'zod';
 */
export const qualityModule = defineModule({
  key: 'quality',
  name: 'Quality & NABH',
  permissions: [],
  grants: {},
});
