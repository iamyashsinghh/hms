// Owned by the "portal" workstream. Its routes go under app/(app)/portal/.
// Add one entry per screen; Home shows those matching the current app variant and the user's permissions.
// Example:
//   { title: 'My screen', route: '/portal/my-screen', permission: 'portal.<resource>.read', variants: ['doctor'] }
import type { MobileModuleScreen } from '../types';

export const screens: MobileModuleScreen[] = [];
