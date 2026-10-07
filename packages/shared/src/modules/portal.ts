import { defineModule } from '../manifest';

/**
 * Patient Portal: permissions and API contracts (Zod schemas + types).
 * Owned by the "portal" workstream. Add permissions as 'portal.<resource>.<action>'
 * and grant them to system roles below. Import zod with: import { z } from 'zod';
 */
export const portalModule = defineModule({
  key: 'portal',
  name: 'Patient Portal',
  permissions: [],
  grants: {},
});
