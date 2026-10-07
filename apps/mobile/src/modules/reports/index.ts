// Reports screens in the mobile apps (owned by the mobile workstream; API owned by "reports").
import type { MobileModuleScreen } from '../types';

export const screens: MobileModuleScreen[] = [
  {
    title: 'Daily summary',
    route: '/reports/owner',
    permission: 'reports.owner_summary.read',
    roles: ['owner', 'hospital_admin'],
    variants: ['owner'],
    description: 'OPD visits, new patients, collections and top doctors',
  },
];
