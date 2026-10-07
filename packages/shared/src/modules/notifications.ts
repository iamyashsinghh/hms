import { defineModule } from '../manifest';

/**
 * Notifications: permissions and API contracts (Zod schemas + types).
 * Owned by the "notifications" workstream. Add permissions as 'notifications.<resource>.<action>'
 * and grant them to system roles below. Import zod with: import { z } from 'zod';
 */
export const notificationsModule = defineModule({
  key: 'notifications',
  name: 'Notifications',
  permissions: [],
  grants: {},
});
