// Owned by the "hr" workstream; screens go in src/app/(app)/hr/.
import { CalendarCheck2, CalendarDays, CalendarRange, Clock, IdCard, LayoutDashboard, UserRound, Users, Wallet } from 'lucide-react';
import type { NavItem } from '../types';

export const nav: NavItem[] = [
  { label: 'HR overview', href: '/hr', permission: 'hr.employee.read', icon: LayoutDashboard },
  { label: 'Employees', href: '/hr/employees', permission: 'hr.employee.read', icon: Users },
  { label: 'Duty roster', href: '/hr/roster', permission: 'hr.roster.read', icon: CalendarRange },
  { label: 'Shifts', href: '/hr/shifts', permission: 'hr.roster.manage', icon: Clock },
  { label: 'Attendance', href: '/hr/attendance', permission: 'hr.attendance.read', icon: CalendarCheck2 },
  { label: 'Leave', href: '/hr/leaves', permission: 'hr.leave.read', icon: CalendarDays },
  { label: 'Payroll', href: '/hr/payroll', permission: 'hr.payroll.read', icon: Wallet },
  { label: 'Licences', href: '/hr/licences', permission: 'hr.employee.read', icon: IdCard },
  { label: 'My HR', href: '/hr/me', permission: 'hr.self.use', icon: UserRound },
];
