// Owned by the "setup" workstream. Its routes go under app/(app)/setup/.
// Add one entry per screen; Home shows those matching the current app variant and the user's permissions.
// Example:
//   { title: 'My screen', route: '/setup/my-screen', permission: 'setup.<resource>.read', variants: ['doctor'] }
import type { MobileModuleScreen } from '../types';

export const screens: MobileModuleScreen[] = [];
