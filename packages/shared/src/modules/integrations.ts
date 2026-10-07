import { defineModule } from '../manifest';

/**
 * Integrations (ABDM): permissions and API contracts (Zod schemas + types).
 * Owned by the "integrations" workstream. Add permissions as 'integrations.<resource>.<action>'
 * and grant them to system roles below. Import zod with: import { z } from 'zod';
 */
export const integrationsModule = defineModule({
  key: 'integrations',
  name: 'Integrations (ABDM)',
  permissions: [],
  grants: {},
});
