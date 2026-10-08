'use client';

// Maintenance work-order table with start / complete / cancel actions (used by /ops/work-orders and /ops/assets/[id]).
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { ops as O } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorBox, Field, MessageRow, PriorityBadge, StatusBadge, WO_STATUS, WO_TYPE_LABELS, formatDateTime, formatINR, num, opt, checked, todayIST } from './ui';

interface CompleteForm {
  id: string;
  type: O.WorkOrderType;
  resolution: string;
  cost: string;
  nextCalibrationDue: string;
}

function downtime(min: number | null) {
  if (min == null) return null;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} h ${min % 60} min` : `${Math.round(h / 24)} days`;
}

export function WorkOrderTable({ items, isPending, showAsset = true }: { items: O.WorkOrder[] | undefined; isPending: boolean; showAsset?: boolean }) {
  const canManage = usePermission('ops.asset.manage');
  const queryClient = useQueryClient();
  const [complete, setComplete] = React.useState<CompleteForm | null>(null);

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: O.UpdateWorkOrder }) => api.ops.workOrders.update(id, checked(O.updateWorkOrderSchema, body)),
    onSuccess: () => {
      setComplete(null);
      void queryClient.invalidateQueries({ queryKey: ['ops'] });
    },
  });

  const cols = showAsset ? 8 : 7;

  return (
    <>
      {update.error && !complete && (
        <div className="p-4 pb-0">
          <ErrorBox error={errorMessage(update.error)} />
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>No.</TableHead>
            {showAsset && <TableHead>Equipment</TableHead>}
            <TableHead>Type</TableHead>
            <TableHead>Problem / work</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Reported</TableHead>
            <TableHead>Result</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending || !items ? (
            <MessageRow cols={cols}>Loading…</MessageRow>
          ) : items.length === 0 ? (
            <MessageRow cols={cols}>No work orders.</MessageRow>
          ) : (
            items.map((w) => {
              const active = w.status === 'open' || w.status === 'in_progress';
              return (
                <React.Fragment key={w.id}>
                  <TableRow>
                    <TableCell className="font-mono text-xs">{w.number}</TableCell>
                    {showAsset && (
                      <TableCell>
                        <Link href={`/ops/assets/${w.assetId}`} className="font-medium text-primary hover:underline">
                          {w.assetName}
                        </Link>
                        <div className="font-mono text-xs text-muted-foreground">{w.assetCode}</div>
                      </TableCell>
                    )}
                    <TableCell>
                      <div>{WO_TYPE_LABELS[w.type]}</div>
                      <PriorityBadge p={w.priority} />
                    </TableCell>
                    <TableCell className="max-w-xs whitespace-normal">
                      {w.problem}
                      {w.assignedTo && <div className="text-xs text-muted-foreground">Assigned: {w.assignedTo}</div>}
                    </TableCell>
                    <TableCell>
                      <StatusBadge s={WO_STATUS[w.status]} />
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDateTime(w.reportedAt)}
                      {w.reportedBy && <div className="text-muted-foreground">{w.reportedBy}</div>}
                    </TableCell>
                    <TableCell className="max-w-xs whitespace-normal text-xs">
                      {w.resolution ?? (w.status === 'completed' ? '—' : '')}
                      {w.cost != null && <div>Cost: {formatINR(w.cost)}</div>}
                      {w.downtimeMinutes != null && <div className="text-muted-foreground">Downtime: {downtime(w.downtimeMinutes)}</div>}
                      {w.completedAt && <div className="text-muted-foreground">Closed {formatDateTime(w.completedAt)}</div>}
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage && active && (
                        <div className="flex justify-end gap-1">
                          {w.status === 'open' && (
                            <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => update.mutate({ id: w.id, body: { status: 'in_progress' } })}>
                              Start
                            </Button>
                          )}
                          <Button size="sm" onClick={() => setComplete({ id: w.id, type: w.type, resolution: '', cost: '', nextCalibrationDue: '' })}>
                            Complete
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={update.isPending}
                            onClick={() => {
                              if (window.confirm(`Cancel work order ${w.number}?`)) update.mutate({ id: w.id, body: { status: 'cancelled' } });
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                  {complete?.id === w.id && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={cols}>
                        <form
                          className="grid gap-3 sm:grid-cols-4"
                          onSubmit={(e) => {
                            e.preventDefault();
                            update.mutate({
                              id: w.id,
                              body: {
                                status: 'completed',
                                resolution: opt(complete.resolution),
                                cost: num(complete.cost),
                                nextCalibrationDue: complete.type === 'calibration' ? opt(complete.nextCalibrationDue) : undefined,
                              },
                            });
                          }}
                        >
                          <div className="sm:col-span-4">
                            <ErrorBox error={update.error ? errorMessage(update.error) : null} />
                          </div>
                          <Field id={`res-${w.id}`} label="Resolution / work done" className="sm:col-span-2">
                            <Input id={`res-${w.id}`} value={complete.resolution} onChange={(e) => setComplete({ ...complete, resolution: e.target.value })} />
                          </Field>
                          <Field id={`cost-${w.id}`} label="Cost (₹)">
                            <Input id={`cost-${w.id}`} type="number" min={0} step="0.01" value={complete.cost} onChange={(e) => setComplete({ ...complete, cost: e.target.value })} />
                          </Field>
                          {complete.type === 'calibration' && (
                            <Field id={`ncd-${w.id}`} label="Next calibration due">
                              <Input id={`ncd-${w.id}`} type="date" min={todayIST()} value={complete.nextCalibrationDue} onChange={(e) => setComplete({ ...complete, nextCalibrationDue: e.target.value })} />
                            </Field>
                          )}
                          <div className="flex items-end justify-end gap-2 sm:col-span-4">
                            <Button type="button" variant="outline" size="sm" onClick={() => setComplete(null)}>
                              Back
                            </Button>
                            <Button type="submit" size="sm" disabled={update.isPending}>
                              {update.isPending && <Loader2 className="animate-spin" />}
                              Mark completed
                            </Button>
                          </div>
                        </form>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })
          )}
        </TableBody>
      </Table>
    </>
  );
}
