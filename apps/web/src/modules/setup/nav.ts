// Owned by the "setup" workstream; screens go in src/app/(app)/setup/.
import { Building2, CalendarClock, FileText, Hash, Hospital, KeyRound, Layers, ListChecks, Stethoscope, UserCog } from 'lucide-react';
import type { NavItem } from '../types';

export const nav: NavItem[] = [
  { label: 'Setup checklist', href: '/setup', permission: 'setup.profile.manage', icon: ListChecks },
  { label: 'Hospital profile', href: '/setup/profile', permission: 'setup.profile.read', icon: Hospital },
  { label: 'Facilities', href: '/setup/facilities', permission: 'core.facility.manage', icon: Building2 },
  { label: 'Departments', href: '/setup/departments', permission: 'setup.department.manage', icon: Layers },
  { label: 'Users', href: '/setup/users', permission: 'core.user.read', icon: UserCog },
  { label: 'Roles', href: '/setup/roles', permission: 'core.role.read', icon: KeyRound },
  { label: 'Staff profiles', href: '/setup/staff', permission: 'setup.staff.read', icon: Stethoscope },
  { label: 'Doctor schedules', href: '/setup/doctors', permission: 'setup.doctor.read', icon: CalendarClock },
  { label: 'Number series', href: '/setup/number-series', permission: 'setup.series.manage', icon: Hash },
  { label: 'Print templates', href: '/setup/print-templates', permission: 'setup.template.manage', icon: FileText },
];
