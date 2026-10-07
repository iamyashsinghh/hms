// Owned by the "portal" workstream; staff screens go in src/app/(app)/portal/, patient pages in src/app/p/.
import { Globe } from 'lucide-react';
import type { NavItem } from '../types';

export const nav: NavItem[] = [{ label: 'Online bookings', href: '/portal', permission: 'portal.booking.read', icon: Globe }];
