// Owned by the "ops" workstream; screens go in src/app/(app)/ops/.
import { Ambulance, Building2, ShieldCheck, Shirt, Sparkles, Stethoscope, UtensilsCrossed, Wrench } from 'lucide-react';
import type { NavItem } from '../types';

export const nav: NavItem[] = [
  { label: 'Facility overview', href: '/ops', permission: 'ops.housekeeping.read', icon: Building2 },
  { label: 'Equipment', href: '/ops/assets', permission: 'ops.asset.read', icon: Stethoscope },
  { label: 'Maintenance', href: '/ops/work-orders', permission: 'ops.asset.read', icon: Wrench },
  { label: 'CSSD', href: '/ops/cssd', permission: 'ops.cssd.read', icon: ShieldCheck },
  { label: 'Linen & laundry', href: '/ops/linen', permission: 'ops.linen.read', icon: Shirt },
  { label: 'Ambulance', href: '/ops/ambulance', permission: 'ops.ambulance.read', icon: Ambulance },
  { label: 'Diet kitchen', href: '/ops/diet', permission: 'ops.diet.read', icon: UtensilsCrossed },
  { label: 'Housekeeping', href: '/ops/housekeeping', permission: 'ops.housekeeping.read', icon: Sparkles },
];
