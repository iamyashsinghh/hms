// Owned by the "crm" workstream; screens go in src/app/(app)/crm/.
import { BellRing, Contact, HandCoins, LayoutDashboard, Megaphone, Stethoscope, Tent } from 'lucide-react';
import type { NavItem } from '../types';

export const nav: NavItem[] = [
  { label: 'CRM overview', href: '/crm', permission: 'crm.lead.read', icon: LayoutDashboard },
  { label: 'Enquiries', href: '/crm/leads', permission: 'crm.lead.read', icon: Contact },
  { label: 'Follow-ups', href: '/crm/follow-ups', permission: 'crm.followup.read', icon: BellRing },
  { label: 'Referrers', href: '/crm/referrers', permission: 'crm.referrer.read', icon: Stethoscope },
  { label: 'Commissions', href: '/crm/commissions', permission: 'crm.commission.read', icon: HandCoins },
  { label: 'Health camps', href: '/crm/camps', permission: 'crm.camp.read', icon: Tent },
  { label: 'Campaigns', href: '/crm/campaigns', permission: 'crm.campaign.manage', icon: Megaphone },
];
