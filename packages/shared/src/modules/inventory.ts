import { defineModule } from '../manifest';

/**
 * Inventory & Procurement: permissions and API contracts (Zod schemas + types).
 * Owned by the "inventory" workstream. Add permissions as 'inventory.<resource>.<action>'
 * and grant them to system roles below. Import zod with: import { z } from 'zod';
 */
export const inventoryModule = defineModule({
  key: 'inventory',
  name: 'Inventory & Procurement',
  permissions: [],
  grants: {},
});
