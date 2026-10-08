'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Loader2, Plus } from 'lucide-react';
import { inventory, todayIso } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { validate } from '@/lib/validate';
import { usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formErrorMessage, LinesEditor, linesValid, Notice, StatusBadge, statusLabel, StoreSelect, useStores, type QtyLine } from '@/modules/inventory/ui';

export default function RequisitionsPage() {
  const canRead = usePermission('inventory.purchase.read');
  const canRequest = usePermission('inventory.purchase.request');
  const canApprove = usePermission('inventory.purchase.approve');
  const canOrder = usePermission('inventory.purchase.order');
  const queryClient = useQueryClient();
  const { stores } = useStores();
  const [status, setStatus] = React.useState<inventory.RequisitionStatus | ''>('');
  const [creating, setCreating] = React.useState(false);
  const [storeId, setStoreId] = React.useState('');
  const [neededBy, setNeededBy] = React.useState('');
  const [lines, setLines] = React.useState<QtyLine[]>([]);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const list = useQuery({
    queryKey: ['inventory', 'requisitions', status],
    queryFn: () => api.inventory.requisitions.list({ status: status || undefined, pageSize: 100 }),
    enabled: canRead,
  });
  const detail = useQuery({
    queryKey: ['inventory', 'requisitions', 'detail', expanded],
    queryFn: () => api.inventory.requisitions.get(expanded!),
    enabled: !!expanded,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['inventory', 'requisitions'] });

  const create = useMutation({
    mutationFn: (body: inventory.CreateRequisition) => api.inventory.requisitions.create(body),
    onSuccess: () => {
      refresh();
      setCreating(false);
      setLines([]);
    },
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' | 'cancel' }) =>
      action === 'cancel' ? api.inventory.requisitions.cancel(id) : api.inventory.requisitions.decide(id, { approve: action === 'approve' }),
    onSuccess: refresh,
  });

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Purchase requisitions"
        description="Stores ask for goods; an approver says yes or no; purchase turns approved ones into orders."
        actions={
          canRequest && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New requisition
            </Button>
          )
        }
      />
      {act.error && <Notice tone="error">{errorMessage(act.error)}</Notice>}

      {creating && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>New requisition</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="req-store">For store *</Label>
                <div className="mt-2">
                  <StoreSelect id="req-store" value={storeId} onChange={setStoreId} stores={stores} />
                </div>
              </div>
              <div>
                <Label htmlFor="req-needed">Needed by</Label>
                <Input id="req-needed" type="date" className="mt-2" min={todayIso()} max={todayIso(366)} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
              </div>
            </div>
            <LinesEditor lines={lines} setLines={setLines} />
            {(formError || create.error) && <p className="text-sm text-destructive">{formError ?? errorMessage(create.error)}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button disabled={!storeId || !linesValid(lines) || create.isPending} onClick={() => {
                  const body = { storeId, neededBy: neededBy || undefined, lines: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })) };
                  const r = validate(inventory.createRequisitionSchema, body);
                  setFormError(formErrorMessage(r.errors, lines));
                  if (!r.errors) create.mutate(body);
                }}>
                {create.isPending && <Loader2 className="animate-spin" />}
                Submit
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mb-4">
        <Select className="w-48" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as inventory.RequisitionStatus | '')}>
          <option value="">All statuses</option>
          {inventory.REQUISITION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-8" />
              <TableHead>Number</TableHead>
              <TableHead>Store</TableHead>
              <TableHead>Raised</TableHead>
              <TableHead>Needed by</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data?.items.length ? (
              list.data.items.map((r) => (
                <React.Fragment key={r.id}>
                  <TableRow>
                    <TableCell>
                      <Button variant="ghost" size="icon" aria-label="Show lines" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                        {expanded === r.id ? <ChevronDown /> : <ChevronRight />}
                      </Button>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.number}</TableCell>
                    <TableCell>{r.storeName}</TableCell>
                    <TableCell>{formatDate(r.createdAt)}</TableCell>
                    <TableCell>{formatDate(r.neededBy)}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        {canApprove && r.status === 'submitted' && (
                          <>
                            <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ id: r.id, action: 'approve' })}>
                              Approve
                            </Button>
                            <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ id: r.id, action: 'reject' })}>
                              Reject
                            </Button>
                          </>
                        )}
                        {canOrder && r.status === 'approved' && (
                          <Link className={buttonVariants({ size: 'sm' })} href={`/inventory/purchase-orders/new?requisitionId=${r.id}`}>
                            Create PO
                          </Link>
                        )}
                        {canRequest && (r.status === 'submitted' || r.status === 'approved') && (
                          <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ id: r.id, action: 'cancel' })}>
                            Cancel
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {expanded === r.id && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell />
                      <TableCell colSpan={6} className="bg-muted/30">
                        {detail.data?.id === r.id ? (
                          <ul className="space-y-1 text-sm">
                            {detail.data.lines?.map((l) => (
                              <li key={l.id}>
                                {l.itemName} — <span className="tabular-nums">{l.qty}</span> {l.unit}
                              </li>
                            ))}
                            {r.decisionNote && <li className="text-muted-foreground">Note: {r.decisionNote}</li>}
                          </ul>
                        ) : (
                          <span className="text-sm text-muted-foreground">Loading…</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                  {list.isPending ? 'Loading…' : 'No requisitions.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
