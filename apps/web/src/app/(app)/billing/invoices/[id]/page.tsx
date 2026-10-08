'use client';

import * as React from 'react';
import Link from 'next/link';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Loader2, Pencil, Printer, Trash2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { billing as B } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorBox, Field, InvoiceStatusBadge, MODE_LABELS, formatDateTime, formatINR } from '@/modules/billing/ui';

export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('billing.invoice.read');
  const router = useRouter();
  const queryClient = useQueryClient();
  const key = ['billing', 'invoices', id];
  const { data: inv, isPending, error } = useQuery({ queryKey: key, queryFn: () => api.billing.invoices.get(id), enabled: canRead });

  const done = (next: B.Invoice) => {
    queryClient.setQueryData(key, next);
    queryClient.invalidateQueries({ queryKey: ['billing'], refetchType: 'none' });
  };
  const finalize = useMutation({ mutationFn: () => api.billing.invoices.finalize(id), onSuccess: done });
  const remove = useMutation({
    mutationFn: () => api.billing.invoices.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing'] });
      router.push('/billing');
    },
  });

  if (!canRead) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;

  const actionError = finalize.error ?? remove.error;

  return (
    <div className="space-y-6">
      <Link href="/billing" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
        <ArrowLeft /> All bills
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            {inv.number ? `Bill ${inv.number}` : 'Draft bill'} <InvoiceStatusBadge inv={inv} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {inv.patientName} · <span className="font-mono">{inv.patientUhid}</span>
            {inv.patientMobile && ` · ${inv.patientMobile}`} · {formatDate(inv.invoiceDate)} · <span className="capitalize">{inv.sourceModule}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {inv.status === 'draft' && (
            <>
              <Can permission="billing.invoice.create">
                <Link href={`/billing/invoices/${id}/edit`} className={buttonVariants({ variant: 'outline' })}>
                  <Pencil /> Edit draft
                </Link>
                <Button variant="outline" disabled={remove.isPending} onClick={() => confirm('Delete this draft?') && remove.mutate()}>
                  <Trash2 /> Delete draft
                </Button>
              </Can>
              <Can permission="billing.invoice.finalize">
                <Button disabled={finalize.isPending} onClick={() => finalize.mutate()}>
                  {finalize.isPending && <Loader2 className="animate-spin" />}
                  Finalize bill
                </Button>
              </Can>
            </>
          )}
          {inv.status !== 'draft' && (
            <Link href={`/billing/invoices/${id}/print`} target="_blank" className={buttonVariants({ variant: 'outline' })}>
              <Printer /> Print
            </Link>
          )}
        </div>
      </div>

      <ErrorBox error={actionError ? errorMessage(actionError) : null} />
      {inv.status === 'cancelled' && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Cancelled {formatDateTime(inv.cancelledAt)}: {inv.cancelReason}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>#</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Disc.</TableHead>
                  <TableHead className="text-right">GST</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inv.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.lineNo}</TableCell>
                    <TableCell>
                      <div className="font-medium">{l.description}</div>
                      <div className="text-xs text-muted-foreground">
                        {l.serviceCode}
                        {l.hsnSac && ` · HSN/SAC ${l.hsnSac}`}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(l.unitPrice)}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.discount ? formatINR(l.discount) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.taxRate}%<div className="text-xs text-muted-foreground">{formatINR(l.taxAmount)}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(l.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {(inv.payments.length > 0 || inv.creditNotes.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle>Receipts, refunds and credit notes</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {inv.payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between py-2">
                      <span>
                        <span className="font-mono text-xs">{p.number}</span> · {MODE_LABELS[p.mode]}
                        {p.reference && ` · ${p.reference}`} · {formatDateTime(p.receivedAt)}
                        {p.kind === 'refund' && (
                          <Badge variant="destructive" className="ml-2">
                            Refund
                          </Badge>
                        )}
                      </span>
                      <span className="tabular-nums">{p.kind === 'refund' ? `− ${formatINR(p.amount)}` : formatINR(p.amount)}</span>
                    </li>
                  ))}
                  {inv.creditNotes.map((c) => (
                    <li key={c.id} className="flex items-center justify-between py-2">
                      <span>
                        <span className="font-mono text-xs">{c.number}</span> · Credit note · {c.reason}
                      </span>
                      <span className="tabular-nums">− {formatINR(c.amount)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-1.5 pt-6 text-sm">
              <Row label="Gross" value={inv.subtotal} />
              {inv.discountTotal > 0 && <Row label="Discount" value={-inv.discountTotal} />}
              <Row label="Taxable value" value={inv.taxableTotal} />
              {inv.supplyType === 'intra' ? (
                <>
                  <Row label="CGST" value={inv.cgstTotal} />
                  <Row label="SGST" value={inv.sgstTotal} />
                </>
              ) : (
                <Row label="IGST" value={inv.igstTotal} />
              )}
              {inv.roundOff !== 0 && <Row label="Round off" value={inv.roundOff} />}
              <div className="flex justify-between border-t pt-2 text-base font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatINR(inv.total)}</span>
              </div>
              {inv.status === 'final' && (
                <>
                  <Row label="Paid" value={inv.paidAmount} />
                  {inv.creditedAmount > 0 && <Row label="Credit notes" value={inv.creditedAmount} />}
                  <div className="flex justify-between font-semibold text-primary">
                    <span>Balance due</span>
                    <span className="tabular-nums">{formatINR(inv.balance)}</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {inv.upiLink && (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 pt-6 text-center text-sm">
                <QRCodeSVG value={inv.upiLink} size={160} />
                <span className="text-muted-foreground">Scan with any UPI app to pay {formatINR(inv.balance)}</span>
              </CardContent>
            </Card>
          )}

          {inv.status === 'final' && inv.balance > 0 && (
            <Can permission="billing.payment.collect">
              <CollectForm key={inv.balance} inv={inv} onDone={done} />
            </Can>
          )}
          {inv.status === 'final' && inv.paidAmount > 0 && (
            <Can permission="billing.payment.refund">
              <RefundForm inv={inv} onDone={() => queryClient.invalidateQueries({ queryKey: ['billing'] })} />
            </Can>
          )}
          {inv.status === 'final' && inv.balance > 0 && (
            <Can permission="billing.creditnote.create">
              <CreditNoteForm inv={inv} onDone={done} />
            </Can>
          )}
          {inv.status === 'final' && inv.paidAmount === 0 && (
            <Can permission="billing.invoice.cancel">
              <CancelForm inv={inv} onDone={done} />
            </Can>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{formatINR(value)}</span>
    </div>
  );
}

function CollectForm({ inv, onDone }: { inv: B.Invoice; onDone: (i: B.Invoice) => void }) {
  const [mode, setMode] = React.useState<B.SettlementMode>('cash');
  const [amount, setAmount] = React.useState(String(inv.balance));
  const [reference, setReference] = React.useState('');
  const pay = useMutation({
    mutationFn: () => api.billing.invoices.pay(inv.id, { mode, amount: Number(amount), reference: reference.trim() || undefined }),
    onSuccess: (next) => {
      setReference('');
      onDone(next);
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Collect payment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ErrorBox error={pay.error ? errorMessage(pay.error) : null} />
        <Field id="pay-mode" label="Mode">
          <Select id="pay-mode" value={mode} onChange={(e) => setMode(e.target.value as B.SettlementMode)}>
            {B.SETTLEMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {MODE_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="pay-amount" label="Amount (₹)">
          <Input id="pay-amount" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        {mode !== 'cash' && mode !== 'deposit' && (
          <Field id="pay-ref" label="Reference (UTR / card last 4 / cheque no.)">
            <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        )}
        <Button className="w-full" disabled={pay.isPending || !(Number(amount) > 0)} onClick={() => pay.mutate()}>
          {pay.isPending && <Loader2 className="animate-spin" />}
          Record {formatINR(Number(amount) || 0)}
        </Button>
      </CardContent>
    </Card>
  );
}

function RefundForm({ inv, onDone }: { inv: B.Invoice; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<B.PaymentMode>('cash');
  const [amount, setAmount] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const refund = useMutation({
    mutationFn: () => api.billing.payments.refund({ invoiceId: inv.id, mode, amount: Number(amount), notes }),
    onSuccess: () => {
      setOpen(false);
      setAmount('');
      setNotes('');
      onDone();
    },
  });
  if (!open)
    return (
      <Button variant="outline" className="w-full" onClick={() => setOpen(true)}>
        Refund payment
      </Button>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Refund (up to {formatINR(inv.paidAmount)})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ErrorBox error={refund.error ? errorMessage(refund.error) : null} />
        <Field id="rf-mode" label="Paid back by">
          <Select id="rf-mode" value={mode} onChange={(e) => setMode(e.target.value as B.PaymentMode)}>
            {B.PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {MODE_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="rf-amount" label="Amount (₹)">
          <Input id="rf-amount" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field id="rf-notes" label="Reason">
          <Input id="rf-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button variant="destructive" disabled={refund.isPending || !(Number(amount) > 0) || notes.trim().length < 3} onClick={() => refund.mutate()}>
            Refund
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CreditNoteForm({ inv, onDone }: { inv: B.Invoice; onDone: (i: B.Invoice) => void }) {
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState('');
  const [reason, setReason] = React.useState('');
  const cn = useMutation({
    mutationFn: () => api.billing.invoices.creditNote(inv.id, { amount: Number(amount), reason }),
    onSuccess: (next) => {
      setOpen(false);
      onDone(next);
    },
  });
  if (!open)
    return (
      <Button variant="outline" className="w-full" onClick={() => setOpen(true)}>
        Issue credit note
      </Button>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Credit note (up to {formatINR(inv.balance)})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ErrorBox error={cn.error ? errorMessage(cn.error) : null} />
        <Field id="cn-amount" label="Amount (₹)">
          <Input id="cn-amount" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field id="cn-reason" label="Reason">
          <Input id="cn-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button disabled={cn.isPending || !(Number(amount) > 0) || reason.trim().length < 3} onClick={() => cn.mutate()}>
            Issue
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CancelForm({ inv, onDone }: { inv: B.Invoice; onDone: (i: B.Invoice) => void }) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const cancel = useMutation({ mutationFn: () => api.billing.invoices.cancel(inv.id, { reason }), onSuccess: onDone });
  if (!open)
    return (
      <Button variant="ghost" className="w-full text-destructive" onClick={() => setOpen(true)}>
        <Ban /> Cancel bill
      </Button>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cancel bill {inv.number}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ErrorBox error={cancel.error ? errorMessage(cancel.error) : null} />
        <Field id="cancel-reason" label="Reason">
          <Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Keep bill
          </Button>
          <Button variant="destructive" disabled={cancel.isPending || reason.trim().length < 3} onClick={() => cancel.mutate()}>
            Cancel bill
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
