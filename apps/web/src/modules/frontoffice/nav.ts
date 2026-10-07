// Owned by the "frontoffice" workstream; screens go in src/app/(app)/frontoffice/.
import { CalendarClock, GitMerge, ListOrdered, Monitor, UserPlus } from 'lucide-react';
import type { NavItem } from '../types';

export const nav: NavItem[] = [
  { label: 'OPD queue', href: '/frontoffice', permission: 'frontoffice.queue.read', icon: ListOrdered },
  { label: 'Appointments', href: '/frontoffice/appointments', permission: 'frontoffice.appointment.read', icon: CalendarClock },
  { label: 'Front desk registration', href: '/frontoffice/register', permission: 'core.patient.create', icon: UserPlus },
  { label: 'Merge duplicates', href: '/frontoffice/merge', permission: 'frontoffice.patient.merge', icon: GitMerge },
  { label: 'TV queue display', href: '/frontoffice/display', permission: 'frontoffice.queue.display', icon: Monitor },
];
