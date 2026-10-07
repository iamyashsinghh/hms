'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { quality as Q } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorBox, Field, IndicatorStatus, currentPeriod, formatIndicator, formatTarget, periodLabel } from '@/modules/quality/ui';

const DEFS = new Map(Q.INDICATORS.map((d) => [d.code, d]));

export default function IndicatorsPage() {
  const can = usePermission('quality.indicator.read');
  const canManage = usePermission('quality.indicator.manage');
  const [period, setPeriod] = React.useState(currentPeriod());
  const [selected, setSelected] = React.useState<string | null>(null);
  const { data, isPending, error } = useQuery({ queryKey: ['quality', 'indicators', period], queryFn: () => api.quality.indicators.list(period), enabled: can });
  if (!can) return <NoAccess />;
  const current = data?.find((i) => i.code === selected) ?? null;
  return (
    <>
      <PageHeader
        title="NABH quality indicators"
        description="Calculated indicators come from incidents, infections, audits, complaints, CAPAs and OPD / prescription activity. Manual ones are entered monthly."
        actions={<Input type="month" aria-label="Month" className="w-40" value={period} max={currentPeriod()} onChange={(e) => e.target.value && setPeriod(e.target.value)} />}
      />
      {error && <p className="mb-4 text-sm text-destructive">{errorMessage(error)}</p>}
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Indicator</TableHead>
                <TableHead className="text-right">Numerator</TableHead>
                <TableHead className="text-right">Denominator</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">Target</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : (
                data?.map((i) => (
                  <TableRow key={i.code} className={cn('cursor-pointer', selected === i.code && 'bg-muted/60')} onClick={() => setSelected(i.code)}>
                    <TableCell>
                      <div className="font-medium">{i.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {i.code} · {i.chapter} {i.source === 'manual' && <Badge variant="outline">Manual</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{i.numerator ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.denominatorLabel ? (i.denominator ?? '—') : ''}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatIndicator(i)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatTarget(i, DEFS.get(i.code)?.lowerIsBetter ?? true)}</TableCell>
                    <TableCell>
                      <IndicatorStatus status={i.status} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
        <div className="space-y-6">
          {current ? (
            <>
              <Trend code={current.code} to={period} />
              {current.source === 'manual' && canManage && <ManualEntry key={`${current.code}-${period}`} r={current} period={period} />}
            </>
          ) : (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">Pick an indicator to see its 6-month trend{canManage ? ' or enter a monthly value' : ''}.</CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Trend({ code, to }: { code: string; to: string }) {
  const { data } = useQuery({ queryKey: ['quality', 'trend', code, to], queryFn: () => api.quality.indicators.trend(code, { months: 6, to }) });
  const def = DEFS.get(code)!;
  const max = Math.max(def.target ?? 0, ...(data?.map((d) => d.value ?? 0) ?? [0]), 1e-9);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{def.name}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {def.numerator}
          {def.denominator && ` ÷ ${def.denominator.toLowerCase()}`}
          {def.multiplier > 1 && ` × ${def.multiplier}`}
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex h-40 items-end gap-2" role="img" aria-label={`Six month trend of ${def.name}`}>
          {data?.map((d) => (
            <div key={d.period} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] tabular-nums text-muted-foreground">{formatIndicator(d)}</span>
              <div
                className={cn('w-full rounded-t', d.status === 'missed' ? 'bg-destructive/70' : 'bg-primary/70')}
                style={{ height: `${d.value == null ? 0 : Math.max(2, (d.value / max) * 110)}px` }}
                title={`${periodLabel(d.period)}: ${formatIndicator(d)}`}
              />
              <span className="text-[10px] text-muted-foreground">{d.period.slice(5)}</span>
            </div>
          ))}
        </div>
        {def.target != null && <p className="mt-2 text-xs text-muted-foreground">Target {formatTarget({ target: def.target, unit: def.unit }, def.lowerIsBetter)}</p>}
      </CardContent>
    </Card>
  );
}

function ManualEntry({ r, period }: { r: Q.IndicatorResult; period: string }) {
  const queryClient = useQueryClient();
  const [num, setNum] = React.useState(r.numerator?.toString() ?? '');
  const [den, setDen] = React.useState(r.denominator?.toString() ?? '');
  const [note, setNote] = React.useState(r.note ?? '');
  const save = useMutation({
    mutationFn: () => api.quality.indicators.saveValue(r.code, { period, numerator: Number(num), denominator: den ? Number(den) : undefined, note: note || undefined }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['quality'] }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Enter value for {periodLabel(period)}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <ErrorBox error={save.error} />
          <Field id="num" label={r.numeratorLabel}>
            <Input id="num" type="number" min={0} step="any" required value={num} onChange={(e) => setNum(e.target.value)} />
          </Field>
          {r.denominatorLabel && (
            <Field id="den" label={r.denominatorLabel}>
              <Input id="den" type="number" min={0} step="any" required value={den} onChange={(e) => setDen(e.target.value)} />
            </Field>
          )}
          <Field id="note" label="Note / source">
            <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />} Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
