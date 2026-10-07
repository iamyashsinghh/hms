// Owned by the "inventory" workstream. Its routes go under app/(app)/inventory/.
// Add one entry per screen; Home shows those matching the current app variant and the user's permissions.
// Example:
//   { title: 'My screen', route: '/inventory/my-screen', permission: 'inventory.<resource>.read', variants: ['doctor'] }
import type { MobileModuleScreen } from '../types';

export const screens: MobileModuleScreen[] = [];
