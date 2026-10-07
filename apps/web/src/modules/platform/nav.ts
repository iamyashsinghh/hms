// Owned by the "platform" workstream; screens go in src/app/(app)/platform/.
import { CreditCard, LifeBuoy, ListChecks } from 'lucide-react';
import type { NavItem } from '../types';

export const nav: NavItem[] = [
  { label: 'Subscription & plan', href: '/platform', permission: 'platform.subscription.read', icon: CreditCard },
  { label: 'Getting started', href: '/platform/onboarding', permission: 'platform.onboarding.manage', icon: ListChecks },
  { label: 'Help & support', href: '/platform/support', permission: 'platform.ticket.create', icon: LifeBuoy },
];
