// Owned by the "billing" workstream; screens go in src/app/(app)/billing/.
import { CalendarClock, FileText, PiggyBank, ReceiptIndianRupee, Settings2, Stethoscope, Tags } from 'lucide-react';
import type { NavItem } from '../types';

export const nav: NavItem[] = [
  { label: 'Bills', href: '/billing', permission: 'billing.invoice.read', icon: ReceiptIndianRupee },
  { label: 'New bill', href: '/billing/new', permission: 'billing.invoice.create', icon: FileText },
  { label: 'Advances & refunds', href: '/billing/deposits', permission: 'billing.invoice.read', icon: PiggyBank },
  { label: 'My cash shift', href: '/billing/shift', permission: 'billing.shift.manage', icon: CalendarClock },
  { label: 'Shifts', href: '/billing/shifts', permission: 'billing.shift.read', icon: CalendarClock },
  { label: 'Services & prices', href: '/billing/services', permission: 'billing.service.read', icon: Stethoscope },
  { label: 'Price lists', href: '/billing/price-lists', permission: 'billing.service.read', icon: Tags },
  { label: 'Billing settings', href: '/billing/settings', permission: 'billing.settings.manage', icon: Settings2 },
];
