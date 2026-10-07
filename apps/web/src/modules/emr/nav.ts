// Owned by the "emr" workstream; screens go in src/app/(app)/emr/.
import { Stethoscope, Star } from 'lucide-react';
import type { NavItem } from '../types';

export const nav: NavItem[] = [
  { label: 'My OPD queue', href: '/emr', permission: 'emr.encounter.read', icon: Stethoscope },
  { label: 'Rx favourites', href: '/emr/favourites', permission: 'emr.prescription.write', icon: Star },
];
