// Owned by the "notifications" workstream; screens go in src/app/(app)/notifications/.
import { Ban, FileText, MessageSquare, Wallet, Workflow } from 'lucide-react';
import type { NavItem } from '../types';

export const nav: NavItem[] = [
  { label: 'Messages', href: '/notifications', permission: 'notifications.message.read', icon: MessageSquare },
  { label: 'Templates', href: '/notifications/templates', permission: 'notifications.template.read', icon: FileText },
  { label: 'Auto messages', href: '/notifications/rules', permission: 'notifications.template.read', icon: Workflow },
  { label: 'Opt-outs', href: '/notifications/opt-outs', permission: 'notifications.optout.manage', icon: Ban },
  { label: 'Credits & settings', href: '/notifications/settings', permission: 'notifications.credit.read', icon: Wallet },
];
