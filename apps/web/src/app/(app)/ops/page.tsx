'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Ambulance, ShieldCheck, Shirt, Sparkles, Stethoscope, UtensilsCrossed } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Stat {
  label: string;
  value: number;
  alert?: boolean;
}

function AreaCard({ title, href, icon: Icon, stats }: { title: string; href: string; icon: React.ComponentType<{ className?: string }>; stats: Stat[] }) {
  return (
    <Link href={href} className="block">
      <Card className="h-full transition-colors hover:border-primary/40">
        <CardHeader className="flex-row items-center gap-2 pb-3">
          <Icon className="size-5 text-primary" />
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3">
            {stats.map((s) => (
              <div key={s.label}>
                <dt className="text-xs text-muted-foreground">{s.label}</dt>
                <dd className={cn('text-2xl font-semibold tabular-nums', s.alert && s.value > 0 && 'text-destructive')}>{s.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function OpsOverviewPage() {
  const asset = usePermission('ops.asset.read');
  const hk = usePermission('ops.housekeeping.read');
  const amb = usePermission('ops.ambulance.read');
  const diet = usePermission('ops.diet.read');
  const cssd = usePermission('ops.cssd.read');
  const linen = usePermission('ops.linen.read');
  const canRead = asset || hk || amb || diet || cssd || linen;

  const { data, error, isPending } = useQuery({ queryKey: ['ops', 'summary'], queryFn: () => api.ops.summary(), enabled: canRead, refetchInterval: 60_000 });

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader title="Facility services" description="Equipment, CSSD, linen, ambulance, diet kitchen and housekeeping at a glance." />
      {error ? (
        <p className="text-sm text-destructive">{errorMessage(error)}</p>
      ) : isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {asset && (
            <AreaCard
              title="Biomedical equipment"
              href="/ops/assets"
              icon={Stethoscope}
              stats={[
                { label: 'Total equipment', value: data.assets.total },
                { label: 'Open breakdowns', value: data.assets.openBreakdowns, alert: true },
                { label: 'Under maintenance', value: data.assets.underMaintenance },
                { label: 'Out of service', value: data.assets.outOfService, alert: true },
                { label: 'PM due', value: data.assets.pmDue, alert: true },
                { label: 'Calibration due', value: data.assets.calibrationDue, alert: true },
              ]}
            />
          )}
          {cssd && (
            <AreaCard
              title="CSSD"
              href="/ops/cssd"
              icon={ShieldCheck}
              stats={[
                { label: 'Sterile sets', value: data.cssd.sterile },
                { label: 'Expired sterile', value: data.cssd.expired, alert: true },
                { label: 'Issued', value: data.cssd.issued },
                { label: 'Dirty', value: data.cssd.dirty },
                { label: 'Cycles today', value: data.cssd.cyclesToday },
                { label: 'Failed today', value: data.cssd.failedToday, alert: true },
              ]}
            />
          )}
          {hk && (
            <AreaCard
              title="Housekeeping"
              href="/ops/housekeeping"
              icon={Sparkles}
              stats={[
                { label: 'Pending', value: data.housekeeping.pending },
                { label: 'In progress', value: data.housekeeping.inProgress },
                { label: 'Overdue', value: data.housekeeping.overdue, alert: true },
                { label: 'Awaiting verification', value: data.housekeeping.awaitingVerification },
              ]}
            />
          )}
          {amb && (
            <AreaCard
              title="Ambulance"
              href="/ops/ambulance"
              icon={Ambulance}
              stats={[
                { label: 'Vehicles available', value: data.ambulance.available },
                { label: 'Active trips', value: data.ambulance.activeTrips },
                { label: 'Trips today', value: data.ambulance.tripsToday },
              ]}
            />
          )}
          {linen && (
            <AreaCard
              title="Linen & laundry"
              href="/ops/linen"
              icon={Shirt}
              stats={[
                { label: 'Items below par', value: data.linen.belowPar, alert: true },
                { label: 'Pieces at laundry', value: data.linen.atLaundry },
              ]}
            />
          )}
          {diet && (
            <AreaCard title="Diet kitchen" href="/ops/diet" icon={UtensilsCrossed} stats={[{ label: 'Active diet orders', value: data.diet.activeOrders }]} />
          )}
        </div>
      )}
    </>
  );
}
