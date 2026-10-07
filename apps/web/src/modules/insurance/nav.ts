// Owned by the "insurance" workstream; screens go in src/app/(app)/insurance/.
import { Building2, FileCheck2, FileStack, LayoutDashboard, ShieldCheck } from 'lucide-react';
import type { NavItem } from '../types';

export const nav: NavItem[] = [
  { label: 'Insurance desk', href: '/insurance', permission: 'insurance.claim.read', icon: LayoutDashboard },
  { label: 'Pre-auths', href: '/insurance/preauths', permission: 'insurance.preauth.read', icon: FileCheck2 },
  { label: 'Claims', href: '/insurance/claims', permission: 'insurance.claim.read', icon: FileStack },
  { label: 'Patient policies', href: '/insurance/policies', permission: 'insurance.policy.read', icon: ShieldCheck },
  { label: 'Payers & schemes', href: '/insurance/payers', permission: 'insurance.payer.read', icon: Building2 },
];
