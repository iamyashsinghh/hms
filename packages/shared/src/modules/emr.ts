import { defineModule } from '../manifest';

/**
 * OPD / EMR: permissions and API contracts (Zod schemas + types).
 * Owned by the "emr" workstream. Add permissions as 'emr.<resource>.<action>'
 * and grant them to system roles below. Import zod with: import { z } from 'zod';
 */
export const emrModule = defineModule({
  key: 'emr',
  name: 'OPD / EMR',
  permissions: [],
  grants: {},
});
