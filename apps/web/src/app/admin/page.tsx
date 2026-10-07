'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { consoleApi } from '@/modules/platform/console/session';
import { useIsSuperAdmin } from '@/modules/platform/console/shell';
import { ErrorBox, StatusBadge, inr } from '@/modules/platform/ui';

function Stat({ label, value, href }: { label: string; value: React.ReactNode; href?: string }) {
  const body = (
    <Card className="h-full transition-colors hover:border-primary/40">
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default function ConsoleDashboard() {
  const qc = useQueryClient();
  const isSuper = useIsSuperAdmin();
  const d = useQuery({ queryKey: ['console', 'dashboard'], queryFn: () => consoleApi.dashboard() });
  const run = useMutation({ mutationFn: () => consoleApi.runLifecycle(), onSuccess: () => qc.invalidateQueries({ queryKey: ['console'] }) });
  if (d.isPending) return <Loader2 className="mx-auto mt-16 size-6 animate-spin text-muted-foreground" />;
  if (d.error) return <ErrorBox error={d.error} />;
  const x = d.data;
  return (
    <>
      <PageHeader
        title="Platform dashboard"
        actions={
          isSuper && (
            <Button variant="outline" onClick={() => run.mutate()} disabled={run.isPending}>
              <RefreshCw className={run.isPending ? 'animate-spin' : ''} /> Run billing lifecycle
            </Button>
          )
        }
      />
      {run.data && (
        <p className="mb-4 text-sm text-muted-foreground">
          Lifecycle: {run.data.trialsExpired} trials ended, {run.data.renewalsIssued} invoices issued, {run.data.movedToGrace} moved to grace,{' '}
          {run.data.suspended} suspended.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="MRR" value={inr(x.mrr)} />
        <Stat label="Unpaid invoices" value={`${x.unpaidInvoices.count} · ${inr(x.unpaidInvoices.total)}`} href="/admin/invoices" />
        <Stat label="Open tickets" value={x.openTickets} href="/admin/tickets" />
        <Stat label="Trials ending in 7 days" value={x.trialsEndingIn7Days} href="/admin/tenants?status=trial" />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Hospitals by status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {Object.entries(x.tenantsByStatus).map(([s, n]) => (
              <Link key={s} href={`/admin/tenants?status=${s}`} className="flex items-center gap-2 rounded-md border px-3 py-2">
                <StatusBadge status={s} /> <span className="font-semibold">{n}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Hospitals by plan</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3 text-sm">
            {Object.entries(x.tenantsByPlan).map(([p, n]) => (
              <span key={p} className="rounded-md border px-3 py-2 capitalize">
                {p}: <b>{n}</b>
              </span>
            ))}
            <span className="rounded-md border px-3 py-2">New in 30 days: <b>{x.signupsLast30Days}</b></span>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
