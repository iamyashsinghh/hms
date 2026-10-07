// Owned by the "lab" workstream; screens go in src/app/(app)/lab/.
import { FlaskConical, Microscope, PlusCircle, TestTubes } from 'lucide-react';
import type { NavItem } from '../types';

export const nav: NavItem[] = [
  { label: 'Lab orders', href: '/lab', permission: 'lab.order.read', icon: Microscope },
  { label: 'New lab order', href: '/lab/new', permission: 'lab.order.create', icon: PlusCircle },
  { label: 'Sample collection', href: '/lab/samples', permission: 'lab.sample.collect', icon: TestTubes },
  { label: 'Tests & panels', href: '/lab/tests', permission: 'lab.test.read', icon: FlaskConical },
];
