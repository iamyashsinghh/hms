'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { lab as L } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorBox } from '@/modules/billing/ui';
import { CollectNow, PaymentStateBadge } from '@/modules/billing/collect-now';
import { needsPayment } from '@/modules/lab/payment-card';
import { PriorityBadge, ageFromDob, formatDateTime, genderShort } from '@/modules/lab/ui';

const TABS: { status: L.SampleStatus; label: string }[] = [
  { status: 'pending', label: 'To collect' },
  { status: 'collected', label: 'To receive in lab' },
  { status: 'rejected', label: 'Rejected' },
];

export default function SampleWorklistPage() {
  const canRead = usePermission('lab.order.read');
  const canCollect = usePermission('lab.sample.collect');
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState<L.SampleStatus>('pending');
  const [scan, setScan] = React.useState('');
  /** Sample row whose order is being paid for ("Collect now" opened under it). */
  const [paying, setPaying] = React.useState<string | null>(null);
  const { data, isPending, error } = useQuery({
    queryKey: ['lab', 'samples', status],
    // A rejected tube that was already recollected carries no tests any more.
    queryFn: () => api.lab.samples.worklist(status).then((rows) => rows.filter((s) => s.testNames.length > 0)),
    enabled: canRead,
    refetchInterval: 20_000,
  });

  const act = useMutation({
    mutationFn: (fn: () => Promise<L.Order>) => fn(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lab'] }),
  });

  if (!canRead) return <NoAccess />;

  // Scanning a barcode on the "to receive" tab receives that tube.
  const onScan = (e: React.FormEvent) => {
    e.preventDefault();
    const s = data?.find((x) => x.barcode === scan.trim().toUpperCase());
    if (!s) return;
    act.mutate(() => (status === 'pending' ? api.lab.samples.collect(s.id) : api.lab.samples.receive(s.id)));
    setScan('');
  };

  return (
    <>
      <PageHeader title="Sample collection" description="Tubes waiting to be drawn, and collected tubes waiting to be received in the lab. STAT and urgent orders come first." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <Button key={t.status} variant={status === t.status ? 'default' : 'outline'} size="sm" onClick={() => setStatus(t.status)}>
            {t.label}
          </Button>
        ))}
        {canCollect && status !== 'rejected' && (
          <form onSubmit={onScan} className="ml-auto w-full max-w-xs">
            <Input placeholder={status === 'pending' ? 'Scan barcode to mark collected' : 'Scan barcode to receive'} value={scan} onChange={(e) => setScan(e.target.value)} />
          </form>
        )}
      </div>
      <div className="mb-4">
        <ErrorBox error={act.error ? errorMessage(act.error) : null} />
      </div>
      <Card>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Barcode</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Sample</TableHead>
                <TableHead>Tests</TableHead>
                <TableHead>Order</TableHead>
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
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    Nothing waiting.
                  </TableCell>
                </TableRow>
              ) : (
                data.map((s) => (
                  <React.Fragment key={s.id}>
                    <TableRow>
                      <TableCell className="font-mono text-xs">{s.barcode}</TableCell>
                      <TableCell>
                        <div className="font-medium">{s.patient.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {s.patient.uhid} · {ageFromDob(s.patient.dateOfBirth)} {genderShort(s.patient.gender)}
                        </div>
                      </TableCell>
                      <TableCell className="capitalize">
                        {s.sampleType}
                        {s.container && <div className="text-xs normal-case text-muted-foreground">{s.container}</div>}
                      </TableCell>
                      <TableCell className="max-w-xs text-sm">
                        <span className="line-clamp-2">{s.testNames.join(', ')}</span>
                        {s.rejectedReason && <div className="text-xs text-destructive">{s.rejectedReason}</div>}
                      </TableCell>
                      <TableCell>
                        <Link href={`/lab/orders/${s.orderId}`} className="font-mono text-xs hover:underline">
                          {s.orderNo}
                        </Link>{' '}
                        <PriorityBadge priority={s.priority} /> <PaymentStateBadge state={s.paymentState} />
                        {s.collectedAt && <div className="text-xs text-muted-foreground">{formatDateTime(s.collectedAt)}</div>}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {s.status === 'pending' && needsPayment(s) && s.paymentState === 'pending' && (
                            <Button size="sm" variant="ghost" onClick={() => setPaying(paying === s.id ? null : s.id)}>
                              Collect now
                            </Button>
                          )}
                          {canCollect && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={act.isPending}
                              onClick={() =>
                                act.mutate(() =>
                                  s.status === 'pending' ? api.lab.samples.collect(s.id) : s.status === 'collected' ? api.lab.samples.receive(s.id) : api.lab.samples.recollect(s.id),
                                )
                              }
                            >
                              {act.isPending && <Loader2 className="animate-spin" />}
                              {s.status === 'pending' ? 'Collected' : s.status === 'collected' ? 'Receive' : 'Recollect'}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {paying === s.id && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={6}>
                          <CollectNow
                            patientId={s.patient.id}
                            source={{ module: 'lab', refId: s.orderId }}
                            onDone={() => queryClient.invalidateQueries({ queryKey: ['lab'] })}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
