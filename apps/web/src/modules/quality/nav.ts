// Owned by the "quality" workstream; screens go in src/app/(app)/quality/.
import { Activity, AlertTriangle, BookOpen, ClipboardCheck, FilePlus2, Gauge, ListChecks, MessageSquareWarning, ShieldPlus, Wrench } from 'lucide-react';
import type { NavItem } from '../types';

export const nav: NavItem[] = [
  { label: 'Quality dashboard', href: '/quality', permission: 'quality.indicator.read', icon: Gauge },
  { label: 'Report incident', href: '/quality/incidents/new', permission: 'quality.incident.report', icon: FilePlus2 },
  { label: 'My reports', href: '/quality/incidents/mine', permission: 'quality.incident.report', icon: ListChecks },
  { label: 'Incidents', href: '/quality/incidents', permission: 'quality.incident.read', icon: AlertTriangle },
  { label: 'Complaints', href: '/quality/complaints', permission: 'quality.complaint.create', icon: MessageSquareWarning },
  { label: 'Infection control', href: '/quality/infection', permission: 'quality.hai.read', icon: ShieldPlus },
  { label: 'Audits', href: '/quality/audits', permission: 'quality.audit.read', icon: ClipboardCheck },
  { label: 'CAPA', href: '/quality/capa', permission: 'quality.capa.read', icon: Wrench },
  { label: 'NABH documents', href: '/quality/documents', permission: 'quality.document.read', icon: BookOpen },
  { label: 'Indicators', href: '/quality/indicators', permission: 'quality.indicator.read', icon: Activity },
];
