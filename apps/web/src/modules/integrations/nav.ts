// Owned by the "integrations" workstream; screens go in src/app/(app)/integrations/.
import { Code2, CreditCard, FileLock2, Fingerprint, Microscope, QrCode, Settings2 } from 'lucide-react';
import type { NavItem } from '../types';

export const nav: NavItem[] = [
  { label: 'Integration settings', href: '/integrations', permission: 'integrations.settings.manage', icon: Settings2 },
  { label: 'ABHA', href: '/integrations/abha', permission: 'integrations.abha.read', icon: Fingerprint },
  { label: 'Scan & Share queue', href: '/integrations/scan-share', permission: 'integrations.abha.read', icon: QrCode },
  { label: 'ABDM consents', href: '/integrations/consents', permission: 'integrations.consent.read', icon: FileLock2 },
  { label: 'Online payments', href: '/integrations/payments', permission: 'integrations.payment.read', icon: CreditCard },
  { label: 'Lab machines', href: '/integrations/devices', permission: 'integrations.device.read', icon: Microscope },
  { label: 'Developer (API & webhooks)', href: '/integrations/developer', permission: 'integrations.developer.manage', icon: Code2 },
];
