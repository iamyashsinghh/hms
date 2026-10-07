// Front-office screens in the mobile apps (owned by the mobile workstream; API owned by "frontoffice").
import type { MobileModuleScreen } from '../types';

export const screens: MobileModuleScreen[] = [
  {
    title: 'OPD queue',
    route: '/frontoffice/queue',
    permission: 'frontoffice.queue.read',
    roles: ['receptionist', 'nurse', 'hospital_admin'],
    variants: ['staff'],
    description: 'Token queue per doctor for the day',
  },
];
