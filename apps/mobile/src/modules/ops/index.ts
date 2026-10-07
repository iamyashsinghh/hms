// Owned by the "ops" workstream. Its routes go under app/(app)/ops/.
// Add one entry per screen; Home shows those matching the current app variant and the user's permissions.
// Example:
//   { title: 'My screen', route: '/ops/my-screen', permission: 'ops.<resource>.read', variants: ['doctor'] }
import type { MobileModuleScreen } from '../types';

export const screens: MobileModuleScreen[] = [];
