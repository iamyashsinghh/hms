'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import type { platform as P } from '@hms/shared';
import { api } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AnnouncementsBanner, ErrorBox } from '@/modules/platform/ui';

export default function OnboardingPage() {
  const can = usePermission('platform.onboarding.manage');
  const qc = useQueryClient();
  const { data, isPending, error } = useQuery({ queryKey: ['platform', 'onboarding'], queryFn: () => api.platform.onboarding(), enabled: can });
  const toggle = useMutation({
    mutationFn: ({ key, done }: { key: P.OnboardingStepKey; done: boolean }) => (done ? api.platform.uncompleteStep(key) : api.platform.completeStep(key)),
    onSuccess: (d) => qc.setQueryData(['platform', 'onboarding'], d),
  });

  if (!can) return <NoAccess />;
  if (isPending) return <Loader2 className="mx-auto mt-16 size-6 animate-spin text-muted-foreground" />;
  if (error) return <ErrorBox error={error} />;

  const pct = Math.round((data.done / data.total) * 100);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Getting started" description={`${data.done} of ${data.total} steps done`} />
      <AnnouncementsBanner className="mb-6" />
      <div className="mb-6 h-2 rounded-full bg-muted">
        <div className="h-2 rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
      <ErrorBox error={toggle.error} />
      <Card className="divide-y">
        {data.steps.map((s) => (
          <div key={s.key} className="flex items-center gap-4 p-4">
            {s.done ? <CheckCircle2 className="size-5 shrink-0 text-accent" /> : <Circle className="size-5 shrink-0 text-muted-foreground" />}
            <div className="flex-1">
              <p className={s.done ? 'font-medium text-muted-foreground line-through' : 'font-medium'}>{s.title}</p>
              <p className="text-sm text-muted-foreground">
                {s.description}
                {s.auto && ' Ticked automatically.'}
              </p>
            </div>
            <Link href={s.href} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              Open
            </Link>
            {!s.auto && (
              <Button variant="outline" size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate({ key: s.key, done: s.done })}>
                {s.done ? 'Undo' : 'Mark done'}
              </Button>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}
