'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Ban, CheckCheck, FileText, Loader2, Printer, ReceiptIndianRupee, Save, TestTube } from 'lucide-react';
import { lab as L } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorBox } from '@/modules/billing/ui';
import {
  FlagMark,
  OrderStatusBadge,
  PriorityBadge,
  SAMPLE_STATUS_LABELS,
  SOURCE_LABELS,
  ageFromDob,
  formatDateTime,
  groupBySection,
  rangeText,
} from '@/modules/lab/ui';

type Draft = Record<string, { value: string; remarks: string }>;

export default function LabOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('lab.order.read');
  const canEnter = usePermission('lab.result.enter');
  const canVerify = usePermission('lab.result.verify');
  const canCollect = usePermission('lab.sample.collect');
  const queryClient = useQueryClient();
  const key = ['lab', 'orders', id];
  const { data: order, error } = useQuery({ queryKey: key, queryFn: () => api.lab.orders.get(id), enabled: canRead });
  const [draft, setDraft] = React.useState<Draft>({});
  const [draftOf, setDraftOf] = React.useState<L.Order | undefined>(undefined);

  // Reset the editable values whenever the server copy changes.
  if (order && order !== draftOf) {
    setDraftOf(order);
    setDraft(Object.fromEntries(order.results.map((r) => [r.id, { value: r.value ?? '', remarks: r.remarks ?? '' }])));
  }

  const act = useMutation({
    mutationFn: (fn: () => Promise<L.Order>) => fn(),
    onSuccess: (o) => {
      queryClient.setQueryData(key, o);
      queryClient.invalidateQueries({ queryKey: ['lab', 'orders'], exact: false, refetchType: 'none' });
    },
  });

  if (!canRead) return <NoAccess />;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  if (!order) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const open = order.status !== 'cancelled';
  const changed = order.results.filter((r) => r.status !== 'verified' && ((draft[r.id]?.value ?? '') !== (r.value ?? '') || (draft[r.id]?.remarks ?? '') !== (r.remarks ?? '')));
  const entered = order.results.filter((r) => r.status === 'entered');
  const unmatched = order.items.filter((i) => i.kind === 'unmatched');
  const sampleOf = (r: L.Result) => order.samples.find((s) => s.id === r.sampleId);

  const saveResults = () =>
    act.mutate(() => api.lab.orders.enterResults(id, { results: changed.map((r) => ({ resultId: r.id, value: draft[r.id]!.value, remarks: draft[r.id]!.remarks || undefined })) }));

  return (
    <>
      <Link href="/lab" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> Lab orders
      </Link>

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold">{order.orderNo}</h1>
            <OrderStatusBadge status={order.status} />
            <PriorityBadge priority={order.priority} />
            {order.hasCritical && (
              <Badge variant="destructive">
                <AlertTriangle className="mr-1 size-3" /> Critical value
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm">
            <span className="font-medium">{order.patient.name}</span> · <span className="font-mono">{order.patient.uhid}</span> · {ageFromDob(order.patient.dateOfBirth)}{' '}
            {order.patient.gender}
            {order.patient.mobile && ` · ${order.patient.mobile}`}
          </p>
          <p className="text-sm text-muted-foreground">
            {SOURCE_LABELS[order.source]} · {formatDateTime(order.createdAt)}
            {(order.doctorName || order.referredBy) && ` · Ref: ${order.doctorName ?? order.referredBy}`}
            {order.clinicalNotes && ` · ${order.clinicalNotes}`}
          </p>
          {order.status === 'cancelled' && <p className="mt-1 text-sm text-destructive">Cancelled: {order.cancelledReason}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/lab/orders/${id}/labels`} className={buttonVariants({ variant: 'outline' })}>
            <Printer /> Sample labels
          </Link>
          <Link href={`/lab/orders/${id}/report`} className={buttonVariants({ variant: order.status === 'completed' ? 'default' : 'outline' })}>
            <FileText /> {order.status === 'completed' ? 'Report' : 'Preview report'}
          </Link>
          {order.invoiceId ? (
            <Can permission="billing.invoice.read" fallback={<Badge variant="outline">Bill {order.invoiceNo}</Badge>}>
              <Link href={`/billing/invoices/${order.invoiceId}`} className={buttonVariants({ variant: 'outline' })}>
                <ReceiptIndianRupee /> {order.invoiceNo}
              </Link>
            </Can>
          ) : (
            open && (
              <Can permission="lab.order.create">
                <Button variant="outline" disabled={act.isPending || unmatched.length === order.items.length} onClick={() => act.mutate(() => api.lab.orders.bill(id))}>
                  <ReceiptIndianRupee /> Create bill
                </Button>
              </Can>
            )
          )}
          {open && order.status !== 'completed' && (
            <Can permission="lab.order.cancel">
              <Button
                variant="ghost"
                onClick={() => {
                  const reason = window.prompt('Why is this order being cancelled?');
                  if (reason && reason.trim().length >= 3) act.mutate(() => api.lab.orders.cancel(id, { reason }));
                }}
              >
                <Ban /> Cancel
              </Button>
            </Can>
          )}
        </div>
      </div>

      <div className="mb-4">
        <ErrorBox error={act.error ? errorMessage(act.error) : null} />
      </div>

      {unmatched.length > 0 && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Not in the test catalogue, so not billed or reported here: {unmatched.map((u) => u.name).join(', ')}. Add the test to the catalogue and book it as a new order if needed.
        </div>
      )}

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Samples</CardTitle>
          {open && canCollect && order.samples.some((s) => s.status === 'pending') && (
            <Button size="sm" disabled={act.isPending} onClick={() => act.mutate(() => api.lab.orders.collectAll(id))}>
              <TestTube /> Collect all
            </Button>
          )}
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Barcode</TableHead>
              <TableHead>Sample</TableHead>
              <TableHead>Tests</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.samples.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-mono text-xs">{s.barcode}</TableCell>
                <TableCell className="capitalize">
                  {s.sampleType}
                  {s.container && <span className="text-xs text-muted-foreground"> · {s.container}</span>}
                </TableCell>
                <TableCell className="max-w-xs text-sm">
                  <span className="line-clamp-2">{s.testNames.join(', ') || '—'}</span>
                </TableCell>
                <TableCell>
                  <Badge variant={s.status === 'rejected' ? 'destructive' : s.status === 'pending' ? 'outline' : 'default'}>{SAMPLE_STATUS_LABELS[s.status]}</Badge>
                  {s.rejectedReason && <div className="text-xs text-destructive">{s.rejectedReason}</div>}
                  {s.collectedAt && <div className="text-xs text-muted-foreground">Collected {formatDateTime(s.collectedAt)}</div>}
                </TableCell>
                <TableCell className="text-right">
                  {open && canCollect && (
                    <div className="flex justify-end gap-1">
                      {s.status === 'pending' && (
                        <Button size="sm" variant="outline" onClick={() => act.mutate(() => api.lab.samples.collect(s.id))}>
                          Collect
                        </Button>
                      )}
                      {(s.status === 'pending' || s.status === 'collected') && (
                        <Button size="sm" variant="outline" onClick={() => act.mutate(() => api.lab.samples.receive(s.id))}>
                          Receive
                        </Button>
                      )}
                      {s.status !== 'rejected' && s.testNames.length > 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const reason = window.prompt('Reason for rejecting this sample (haemolysed, clotted, insufficient…)');
                            if (reason && reason.trim().length >= 3) act.mutate(() => api.lab.samples.reject(s.id, { reason }));
                          }}
                        >
                          Reject
                        </Button>
                      )}
                      {s.status === 'rejected' && s.testNames.length > 0 && (
                        <Button size="sm" variant="outline" onClick={() => act.mutate(() => api.lab.samples.recollect(s.id))}>
                          Recollect
                        </Button>
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Results</CardTitle>
          {open && (
            <div className="flex gap-2">
              {canEnter && (
                <Button size="sm" variant="outline" disabled={!changed.length || act.isPending} onClick={saveResults}>
                  {act.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save results
                </Button>
              )}
              {canVerify && (
                <Button size="sm" disabled={!entered.length || changed.length > 0 || act.isPending} onClick={() => act.mutate(() => api.lab.orders.verify(id))}>
                  <CheckCheck /> Verify {entered.length ? `(${entered.length})` : ''}
                </Button>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Test</TableHead>
                <TableHead className="w-48">Result</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Remarks</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupBySection(order.results).map((g) => (
                <React.Fragment key={g.section}>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={6} className="py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {L.SECTION_LABELS[g.section]}
                    </TableCell>
                  </TableRow>
                  {g.results.map((r) => {
                    const sample = sampleOf(r);
                    const ready = sample && (sample.status === 'collected' || sample.status === 'received');
                    const editable = open && canEnter && r.status !== 'verified' && !!ready;
                    const d = draft[r.id] ?? { value: '', remarks: '' };
                    const flag = d.value ? L.flagFor(r, d.value) : null;
                    const set = (patch: Partial<typeof d>) => setDraft({ ...draft, [r.id]: { ...d, ...patch } });
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-medium">{r.name}</div>
                          {r.panelName && <div className="text-xs text-muted-foreground">{r.panelName}</div>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center">
                            {r.resultType === 'option' ? (
                              <Select aria-label={r.name} disabled={!editable} value={d.value} onChange={(e) => set({ value: e.target.value })}>
                                <option value="" />
                                {r.options.map((o) => (
                                  <option key={o} value={o}>
                                    {o}
                                  </option>
                                ))}
                              </Select>
                            ) : (
                              <Input
                                aria-label={r.name}
                                inputMode={r.resultType === 'numeric' ? 'decimal' : 'text'}
                                disabled={!editable}
                                value={d.value}
                                onChange={(e) => set({ value: e.target.value })}
                                className={flag && flag !== 'normal' ? 'border-destructive font-semibold text-destructive' : ''}
                              />
                            )}
                            <FlagMark flag={flag} />
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.unit}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{rangeText(r)}</TableCell>
                        <TableCell>
                          <Input aria-label={`${r.name} remarks`} disabled={!editable} value={d.remarks} onChange={(e) => set({ remarks: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          {r.status === 'verified' ? (
                            <div className="flex items-center gap-1">
                              <Badge variant="accent">Verified</Badge>
                              {open && canVerify && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    const reason = window.prompt(`Why does ${r.name} need correcting?`);
                                    if (reason && reason.trim().length >= 3) act.mutate(() => api.lab.orders.amend(id, { resultId: r.id, reason }));
                                  }}
                                >
                                  Amend
                                </Button>
                              )}
                            </div>
                          ) : r.status === 'entered' ? (
                            <Badge>Entered</Badge>
                          ) : (
                            <Badge variant="outline">{ready ? 'Pending' : 'No sample'}</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
          {order.verifiedAt && (
            <p className="border-t px-4 py-3 text-sm text-muted-foreground">
              Verified by {order.verifiedByName ?? '—'} on {formatDateTime(order.verifiedAt)}
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
