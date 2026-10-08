'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarCheck, Gauge, Loader2, Pencil, TriangleAlert } from 'lucide-react';
import { ops as O } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { ASSET_CATEGORY_LABELS, ASSET_STATUS, DueDate, ErrorBox, Field, StatusBadge, formatDay, formatINR, humanize, checked } from '@/modules/ops/ui';
import { AssetForm, BreakdownForm, assetToForm } from '@/modules/ops/assets';
import { WorkOrderTable } from '@/modules/ops/work-orders';

function ScheduleForm({ asset, type, onDone }: { asset: O.Asset; type: 'preventive' | 'calibration'; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [problem, setProblem] = React.useState(type === 'preventive' ? 'Scheduled preventive maintenance' : 'Scheduled calibration');
  const [priority, setPriority] = React.useState<'low' | 'normal' | 'urgent'>('normal');
  const create = useMutation({
    mutationFn: () => api.ops.workOrders.create(checked(O.createWorkOrderSchema, { assetId: asset.id, type, problem: problem.trim(), priority })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] });
      onDone();
    },
  });
  return (
    <form
      className="grid gap-3 sm:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <div className="sm:col-span-6">
        <ErrorBox error={create.error ? errorMessage(create.error) : null} />
      </div>
      <Field id="sch-problem" label={type === 'preventive' ? 'PM work order *' : 'Calibration work order *'} className="sm:col-span-4">
        <Input id="sch-problem" value={problem} onChange={(e) => setProblem(e.target.value)} required />
      </Field>
      <Field id="sch-priority" label="Priority">
        <Select id="sch-priority" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="urgent">Urgent</option>
        </Select>
      </Field>
      <div className="flex items-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Back
        </Button>
        <Button type="submit" size="sm" disabled={create.isPending}>
          {create.isPending && <Loader2 className="animate-spin" />}
          Create
        </Button>
      </div>
    </form>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

export default function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('ops.asset.read');
  const canManage = usePermission('ops.asset.manage');
  const canReport = usePermission('ops.asset.report');
  const [mode, setMode] = React.useState<'edit' | 'breakdown' | 'preventive' | 'calibration' | null>(null);

  const { data: asset, error } = useQuery({ queryKey: ['ops', 'assets', id], queryFn: () => api.ops.assets.get(id), enabled: canRead });
  const wo = useQuery({
    queryKey: ['ops', 'work-orders', { assetId: id }],
    queryFn: () => api.ops.workOrders.list({ assetId: id, pageSize: 100 }),
    enabled: canRead,
  });

  if (!canRead) return <NoAccess />;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  if (!asset) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <>
      <Link href="/ops/assets" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> Equipment
      </Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {asset.name} <span className="font-mono text-base text-muted-foreground">{asset.code}</span>
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge s={ASSET_STATUS[asset.status]} />
            <span>{ASSET_CATEGORY_LABELS[asset.category]}</span>
            <Badge variant={asset.criticality === 'high' ? 'destructive' : 'outline'}>{humanize(asset.criticality)} criticality</Badge>
            {asset.location && <span>· {asset.location}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canReport && asset.status !== 'condemned' && (
            <Button variant="outline" onClick={() => setMode('breakdown')}>
              <TriangleAlert /> Report breakdown
            </Button>
          )}
          {canManage && (
            <>
              <Button variant="outline" onClick={() => setMode('preventive')}>
                <CalendarCheck /> Schedule PM
              </Button>
              <Button variant="outline" onClick={() => setMode('calibration')}>
                <Gauge /> Schedule calibration
              </Button>
              <Button onClick={() => setMode('edit')}>
                <Pencil /> Edit
              </Button>
            </>
          )}
        </div>
      </div>

      {mode === 'edit' && canManage && <AssetForm initial={assetToForm(asset)} onDone={() => setMode(null)} />}
      {(mode === 'breakdown' || mode === 'preventive' || mode === 'calibration') && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{mode === 'breakdown' ? 'Report breakdown' : mode === 'preventive' ? 'Schedule preventive maintenance' : 'Schedule calibration'}</CardTitle>
          </CardHeader>
          <CardContent>
            {mode === 'breakdown' ? <BreakdownForm asset={asset} onDone={() => setMode(null)} /> : <ScheduleForm asset={asset} type={mode} onDone={() => setMode(null)} />}
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardContent className="pt-6">
          <dl className="grid gap-4 sm:grid-cols-4">
            <Info label="Make / model">{[asset.make, asset.model].filter(Boolean).join(' ') || '—'}</Info>
            <Info label="Serial no.">{asset.serialNo ?? '—'}</Info>
            <Info label="Purchased">
              {formatDay(asset.purchaseDate)} {asset.purchaseCost != null && `· ${formatINR(asset.purchaseCost)}`}
            </Info>
            <Info label="Vendor">{asset.vendor ?? '—'}</Info>
            <Info label="Warranty until">
              <DueDate date={asset.warrantyUntil} />
            </Info>
            <Info label="AMC">
              {asset.amcVendor ?? '—'} · <DueDate date={asset.amcUntil} />
            </Info>
            <Info label="Next PM">
              <DueDate date={asset.nextPmDue} /> {asset.pmIntervalDays ? <span className="text-xs text-muted-foreground">(every {asset.pmIntervalDays} days)</span> : null}
            </Info>
            <Info label="Calibration due">
              <DueDate date={asset.calibrationDue} />
            </Info>
            {asset.notes && (
              <div className="sm:col-span-4">
                <Info label="Notes">{asset.notes}</Info>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Work orders</CardTitle>
        </CardHeader>
        {wo.error ? <p className="p-6 text-sm text-destructive">{errorMessage(wo.error)}</p> : <WorkOrderTable items={wo.data?.items} isPending={wo.isPending} showAsset={false} />}
      </Card>
    </>
  );
}
