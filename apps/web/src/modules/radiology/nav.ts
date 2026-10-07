// Owned by the "radiology" workstream; screens go in src/app/(app)/radiology/.
import { CalendarDays, FilePlus2, ListChecks, ScanLine } from 'lucide-react';
import type { NavItem } from '../types';

export const nav: NavItem[] = [
  { label: 'Radiology worklist', href: '/radiology', permission: 'radiology.order.read', icon: ScanLine },
  { label: 'New radiology order', href: '/radiology/new', permission: 'radiology.order.create', icon: FilePlus2 },
  { label: 'Scan schedule', href: '/radiology/schedule', permission: 'radiology.order.read', icon: CalendarDays },
  { label: 'Radiology masters', href: '/radiology/masters', permission: 'radiology.master.read', icon: ListChecks },
];
