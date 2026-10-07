'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight, Circle, Loader2, PartyPopper } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorBox } from '@/modules/setup/ui';

export default function SetupHomePage() {
  const canManage = usePermission('setup.profile.manage');
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({ queryKey: ['setup', 'wizard'], queryFn: () => api.setup.wizard(), enabled: canManage });
  const complete = useMutation({
    mutationFn: () => api.setup.completeWizard(),
    onSuccess: (w) => queryClient.setQueryData(['setup', 'wizard'], w),
  });

  if (!canManage) return <NoAccess />;

  const done = data?.steps.filter((s) => s.done).length ?? 0;
  const total = data?.steps.length ?? 6;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Hospital setup" description="Finish these steps once and your hospital is ready for OPD, billing and pharmacy." />
      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{errorMessage(error)}</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              {done} of {total} steps done
            </CardTitle>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${(done / total) * 100}%` }} />
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.steps.map((s, i) => (
              <Link key={s.key} href={s.href} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50">
                {s.done ? <CheckCircle2 className="size-5 text-emerald-600" /> : <Circle className="size-5 text-muted-foreground" />}
                <span className="flex-1">
                  <span className="text-sm font-medium">
                    {i + 1}. {s.label}
                  </span>
                  {s.count > 0 && <span className="ml-2 text-xs text-muted-foreground">({s.count})</span>}
                </span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            ))}
            <div className="pt-4">
              <ErrorBox error={complete.error} />
              {data.completed ? (
                <p className="flex items-center gap-2 text-sm text-emerald-700">
                  <PartyPopper className="size-4" /> Setup marked complete on {new Date(data.completedAt!).toLocaleDateString('en-IN')}.
                </p>
              ) : (
                <Button onClick={() => complete.mutate()} disabled={complete.isPending || done < total}>
                  {complete.isPending && <Loader2 className="animate-spin" />}
                  Mark setup complete
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
