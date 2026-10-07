import { Cross } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent text-white', className)}>
      <Cross className="size-4" fill="currentColor" />
    </span>
  );
}
