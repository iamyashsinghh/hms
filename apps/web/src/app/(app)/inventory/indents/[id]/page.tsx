'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Pencil, Printer } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { expiryLabel } from '@/modules/pharmacy/format';
import { Notice, StatusBadge } from '@/modules/inventory/ui';

export default function IndentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('inventory.indent.read');
  const canCreate = usePermission('inventory.indent.create');
  const canApprove = usePermission('inventory.indent.approve');
  const canIssue = usePermission('inventory.indent.issue');
  const queryClient = useQueryClient();
  const [qty, setQty] = React.useState<Record<string, string>>({});
  const [qtyError, setQtyError] = React.useState<string | null>(null);

  const indent = useQuery({ queryKey: ['inventory', 'indents', id], queryFn: () => api.inventory.indents.get(id), enabled: canRead });
  const data = indent.data;
  const mode = !data ? null : data.status === 'submitted' && canApprove ? 'approve' : (data.status === 'approved' || data.status === 'partially_issued') && canIssue ? 'issue' : null;

  // Edits over the defaults: approve what was asked for, issue what is pending.
  const valueOf = (l: { id: string; requestedQty: number; pendingQty: number }) => qty[l.id] ?? String(mode === 'approve' ? l.requestedQty : l.pendingQty);
  const entries = () => (data?.lines ?? []).map((l) => [l.id, valueOf(l)] as const);

  const onDone = () => {
    setQty({});
    queryClient.invalidateQueries({ queryKey: ['inventory', 'indents'] });
    queryClient.invalidateQueries({ queryKey: ['pharmacy'] });
  };
  const decide = useMutation({
    mutationFn: (approve: boolean) =>
      api.inventory.indents.decide(id, {
        approve,
        lines: approve ? entries().map(([indentLineId, q]) => ({ indentLineId, approvedQty: Number(q || 0) })) : undefined,
      }),
    onSuccess: onDone,
  });
  const issue = useMutation({
    mutationFn: () =>
      api.inventory.indents.issue(id, {
        lines: entries()
          .filter(([, q]) => Number(q) > 0)
          .map(([indentLineId, q]) => ({ indentLineId, qty: Number(q) })),
      }),
    onSuccess: onDone,
  });
  const other = useMutation({
    mutationFn: async (action: 'cancel' | 'close') => {
      if (action === 'cancel') return api.inventory.indents.cancel(id);
      const reason = window.prompt('Why close this indent without issuing the rest?');
      return reason?.trim() ? api.inventory.indents.close(id, { reason }) : null;
    },
    onSuccess: onDone,
  });

  if (!canRead) return <NoAccess />;
  if (indent.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (indent.error || !data) return <p className="text-sm text-destructive">{errorMessage(indent.error)}</p>;
  const lines = data.lines ?? [];
  const error = decide.error ?? issue.error ?? other.error;
  /** Whole numbers from 0 up to what was asked for (approve) or is still pending (issue). */
  const checkQty = (): string | null => {
    for (const l of data.lines ?? []) {
      const raw = valueOf(l).trim();
      const n = Number(raw || 0);
      const max = mode === 'approve' ? l.requestedQty : l.pendingQty;
      if (!Number.isInteger(n) || n < 0) return `${l.itemName}: enter a whole number of ${l.unit}`;
      if (n > max) return `${l.itemName}: cannot ${mode === 'approve' ? 'approve more than the' : 'issue more than the'} ${max} ${mode === 'approve' ? 'asked for' : 'pending'}`;
    }
    return null;
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/inventory/indents" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Indents
        </Link>
        <div className="flex gap-2">
          {canCreate && data.status === 'submitted' && (
            <Link href={`/inventory/indents/${id}/edit`} className={buttonVariants({ variant: 'outline' })}>
              <Pencil /> Edit
            </Link>
          )}
          {canCreate && data.status === 'submitted' && (
            <Button variant="outline" disabled={other.isPending} onClick={() => other.mutate('cancel')}>
              Cancel indent
            </Button>
          )}
          {canApprove && (data.status === 'approved' || data.status === 'partially_issued') && (
            <Button variant="outline" disabled={other.isPending} onClick={() => other.mutate('close')}>
              Close
            </Button>
          )}
          <Button variant="outline" onClick={() => window.print()}>
            <Printer /> Print
          </Button>
        </div>
      </div>
      {issue.data && <Notice>Issued. Stock has moved to {data.toStoreName}.</Notice>}
      {(qtyError || error) && <Notice tone="error">{qtyError ?? errorMessage(error)}</Notice>}

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-xl">
                Indent {data.number} {data.priority === 'urgent' && <Badge variant="destructive">Urgent</Badge>}
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDate(data.createdAt)} · {data.toStoreName} asks {data.fromStoreName}
              </p>
              {data.notes && <p className="mt-1 text-sm">{data.notes}</p>}
              {data.decisionNote && <p className="mt-1 text-sm text-muted-foreground">Note: {data.decisionNote}</p>}
            </div>
            <StatusBadge status={data.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Asked</TableHead>
                <TableHead className="text-right">Approved</TableHead>
                <TableHead className="text-right">Issued</TableHead>
                {mode && <TableHead>{mode === 'approve' ? 'Approve qty' : 'Issue now'}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <div className="font-medium">{l.itemName}</div>
                    <div className="text-xs text-muted-foreground">
                      {l.itemCode} · per {l.unit}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{l.requestedQty}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.approvedQty ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.issuedQty}</TableCell>
                  {mode && (
                    <TableCell>
                      <Input
                        className="w-24"
                        type="number"
                        min={0}
                        step={1}
                        max={mode === 'approve' ? l.requestedQty : l.pendingQty}
                        disabled={mode === 'issue' && l.pendingQty === 0}
                        aria-label={`${mode === 'approve' ? 'Approve' : 'Issue'} qty of ${l.itemName}`}
                        value={valueOf(l)}
                        onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {mode === 'approve' && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={decide.isPending} onClick={() => decide.mutate(false)}>
                Reject
              </Button>
              <Button disabled={decide.isPending} onClick={() => {
                  const problem = checkQty();
                  setQtyError(problem);
                  if (!problem) decide.mutate(true);
                }}>
                {decide.isPending && <Loader2 className="animate-spin" />}
                Approve
              </Button>
            </div>
          )}
          {mode === 'issue' && (
            <div className="flex items-center justify-end gap-4">
              <span className="text-xs text-muted-foreground">Batches are picked first-expiry-first-out from {data.fromStoreName}.</span>
              <Button disabled={issue.isPending || !entries().some(([, q]) => Number(q) > 0)} onClick={() => {
                  const problem = checkQty();
                  setQtyError(problem);
                  if (!problem) issue.mutate();
                }}>
                {issue.isPending && <Loader2 className="animate-spin" />}
                Issue stock
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {!!data.issues?.length && (
        <Card>
          <CardHeader>
            <CardTitle>Issues</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Issue</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead className="text-right">Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.issues.flatMap((iss) =>
                iss.lines.map((l, i) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-xs">{i === 0 ? iss.number : ''}</TableCell>
                    <TableCell>{i === 0 ? formatDate(iss.createdAt) : ''}</TableCell>
                    <TableCell>{lines.find((x) => x.id === l.indentLineId)?.itemName}</TableCell>
                    <TableCell className="font-mono text-xs">{l.batchNo}</TableCell>
                    <TableCell>{l.expiryDate === '2099-12-31' ? '—' : expiryLabel(l.expiryDate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
