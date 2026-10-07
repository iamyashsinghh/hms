import { defineModule } from '../manifest';

/**
 * Front Office: permissions and API contracts (Zod schemas + types).
 * Owned by the "frontoffice" workstream. Add permissions as 'frontoffice.<resource>.<action>'
 * and grant them to system roles below. Import zod with: import { z } from 'zod';
 */
export const frontofficeModule = defineModule({
  key: 'frontoffice',
  name: 'Front Office',
  permissions: [],
  grants: {},
});
