// Owned by the "ipd" workstream; screens go in src/app/(app)/ipd/.
import { BedDouble, ClipboardList, Settings2, UserPlus } from 'lucide-react';
import type { NavItem } from '../types';

export const nav: NavItem[] = [
  { label: 'Bed board', href: '/ipd', permission: 'ipd.ward.read', icon: BedDouble },
  { label: 'Admissions', href: '/ipd/admissions', permission: 'ipd.admission.read', icon: ClipboardList },
  { label: 'Admit patient', href: '/ipd/admit', permission: 'ipd.admission.create', icon: UserPlus },
  { label: 'Wards & beds', href: '/ipd/wards', permission: 'ipd.ward.manage', icon: Settings2 },
];
