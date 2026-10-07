'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Circle } from 'lucide-react';
import { visibleNav } from '@/modules';
import { useAuth } from '@/lib/auth';
import { Logo } from '@/components/logo';
import { cn } from '@/lib/utils';

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const sections = visibleNav(user?.permissions ?? []);

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
        <Logo />
        <span className="text-lg font-semibold tracking-tight text-white">HMS</span>
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {sections.map((section) => (
          <div key={section.key}>
            <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{section.title}</p>
            <ul className="space-y-1">
              {section.items.map((item) => {
                const Icon = item.icon ?? Circle;
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                        active ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-white',
                      )}
                    >
                      <Icon className={cn('size-4', active && 'text-teal-300')} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
