import type { Metadata } from 'next';
import { ConsoleSessionProvider } from '@/modules/platform/console/session';
import { ConsoleShell } from '@/modules/platform/console/shell';

export const metadata: Metadata = { title: { default: 'Platform console', template: '%s · HMS Console' } };

/** Super-admin console (HMS team). Separate login from hospital staff. Owned by the "platform" workstream. */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConsoleSessionProvider>
      <ConsoleShell>{children}</ConsoleShell>
    </ConsoleSessionProvider>
  );
}
