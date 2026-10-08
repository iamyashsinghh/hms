'use client';

// Tab strips for billing pages that share a header (Bills / Unbilled, Bill printing / Billing rules).
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePermission } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface Tab {
  href: string;
  label: string;
  permission?: string;
}

function Tabs({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();
  return (
    <nav className="mb-4 flex gap-1 border-b" aria-label="Sections">
      {tabs.map((t) => (
        <TabLink key={t.href} tab={t} active={pathname === t.href} />
      ))}
    </nav>
  );
}

function TabLink({ tab, active }: { tab: Tab; active: boolean }) {
  const allowed = usePermission(tab.permission);
  if (!allowed) return null;
  return (
    <Link
      href={tab.href}
      aria-current={active ? 'page' : undefined}
      className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium', active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
    >
      {tab.label}
    </Link>
  );
}

export function BillsTabs() {
  return (
    <Tabs
      tabs={[
        { href: '/billing', label: 'Bills', permission: 'billing.invoice.read' },
        { href: '/billing/unbilled', label: 'Unbilled', permission: 'billing.invoice.read' },
      ]}
    />
  );
}

export function SettingsTabs() {
  return (
    <Tabs
      tabs={[
        { href: '/billing/settings', label: 'Bill printing', permission: 'billing.settings.manage' },
        { href: '/billing/settings/rules', label: 'Billing rules', permission: 'billing.service.read' },
      ]}
    />
  );
}
