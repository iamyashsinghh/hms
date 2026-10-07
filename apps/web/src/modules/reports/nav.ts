// Owned by the "reports" workstream; screens go in src/app/(app)/reports/.
import { BarChart3, IndianRupee, Stethoscope, UserPlus, Wallet } from 'lucide-react';
import type { NavItem } from '../types';

export const nav: NavItem[] = [
  { label: 'MIS dashboard', href: '/reports', permission: 'reports.dashboard.read', icon: BarChart3 },
  { label: 'Daily collection', href: '/reports/collection', permission: 'reports.collection.read', icon: Wallet },
  { label: 'OPD report', href: '/reports/opd', permission: 'reports.opd.read', icon: Stethoscope },
  { label: 'Revenue report', href: '/reports/revenue', permission: 'reports.revenue.read', icon: IndianRupee },
  { label: 'Patient report', href: '/reports/patients', permission: 'reports.patient.read', icon: UserPlus },
];
