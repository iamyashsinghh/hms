'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { setup } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorBox } from '@/modules/setup/ui';

function Row({ series }: { series: setup.NumberSeries }) {
  const queryClient = useQueryClient();
  const [prefix, setPrefix] = React.useState(series.prefix);
  const [width, setWidth] = React.useState(series.width);
  const [next, setNext] = React.useState(series.nextValue);
  const save = useMutation({
    mutationFn: () => api.setup.updateNumberSeries(series.key, { prefix, width, nextValue: next !== series.nextValue ? next : undefined }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['setup', 'number-series'] }),
  });
  const changed = prefix !== series.prefix || width !== series.width || next !== series.nextValue;
  return (
    <TableRow>
      <TableCell>
        <p className="font-medium">{series.label}</p>
        <p className="font-mono text-xs text-muted-foreground">{series.key}</p>
        {save.error ? <ErrorBox error={save.error} /> : null}
      </TableCell>
      <TableCell>
        <Input aria-label="Prefix" className="w-28" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
      </TableCell>
      <TableCell>
        <Input aria-label="Digits" type="number" min={1} max={12} className="w-20" value={width} onChange={(e) => setWidth(Number(e.target.value))} />
      </TableCell>
      <TableCell>
        <Input aria-label="Next number" type="number" min={series.nextValue} className="w-28" value={next} onChange={(e) => setNext(Number(e.target.value))} />
      </TableCell>
      <TableCell className="font-mono text-sm">{`${prefix}${String(next).padStart(width, '0')}`}</TableCell>
      <TableCell className="text-right">
        <Button size="sm" disabled={!changed || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </TableCell>
    </TableRow>
  );
}

export default function NumberSeriesPage() {
  const canManage = usePermission('setup.series.manage');
  const { data, isPending, error } = useQuery({ queryKey: ['setup', 'number-series'], queryFn: () => api.setup.listNumberSeries(), enabled: canManage });
  if (!canManage) return <NoAccess />;
  return (
    <>
      <PageHeader title="Number series" description="Prefixes for UHID, bills and receipts. The next number can only move forward so numbers never repeat." />
      <Card>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Series</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Digits</TableHead>
                <TableHead>Next no</TableHead>
                <TableHead>Preview</TableHead>
                <TableHead />
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
                data.map((s) => <Row key={`${s.key}:${s.prefix}:${s.width}:${s.nextValue}`} series={s} />)
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
