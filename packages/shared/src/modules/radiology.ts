import { defineModule } from '../manifest';

/**
 * Radiology: permissions and API contracts (Zod schemas + types).
 * Owned by the "radiology" workstream. Add permissions as 'radiology.<resource>.<action>'
 * and grant them to system roles below. Import zod with: import { z } from 'zod';
 */
export const radiologyModule = defineModule({
  key: 'radiology',
  name: 'Radiology',
  permissions: [],
  grants: {},
});
