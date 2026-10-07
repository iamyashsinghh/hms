// Owned by the "billing" workstream. Its routes go under app/(app)/billing/.
// Add one entry per screen; Home shows those matching the current app variant and the user's permissions.
// Example:
//   { title: 'My screen', route: '/billing/my-screen', permission: 'billing.<resource>.read', variants: ['doctor'] }
import type { MobileModuleScreen } from '../types';

export const screens: MobileModuleScreen[] = [];
