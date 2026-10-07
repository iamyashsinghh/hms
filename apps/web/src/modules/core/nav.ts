// Owned by the "core" workstream; screens go in src/app/(app)/ (dashboard, patients).
import { LayoutDashboard, Users } from 'lucide-react';
import type { NavItem } from '../types';

export const nav: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Patients', href: '/patients', permission: 'core.patient.read', icon: Users },
];
