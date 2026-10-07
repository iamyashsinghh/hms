// EMR screens in the mobile apps (owned by the mobile workstream; API owned by "emr").
import type { MobileModuleScreen } from '../types';

export const screens: MobileModuleScreen[] = [
  {
    title: "Today's OPD queue",
    route: '/emr/queue',
    permission: 'emr.encounter.read',
    roles: ['doctor'],
    variants: ['doctor'],
    description: 'Checked-in patients, timeline and prescriptions',
  },
];
