'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { billing as B, type Patient } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorBox, Field, InvoiceStatusBadge, MODE_LABELS, PatientPicker, formatDateTime, formatINR } from '@/modules/billing/ui';

export default function DepositsPage() {
  const canRead = usePermission('billing.invoice.read');
  const [patient, setPatient] = React.useState<Patient | null>(null);
  const queryClient = useQueryClient();
  const key = ['billing', 'account', patient?.id];
  const { data: acct, error } = useQuery({ queryKey: key, queryFn: () => api.billing.account(patient!.id), enabled: canRead && !!patient });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader title="Advances & refunds" description="Take an advance (deposit) from a patient, see what they owe, and refund unused advance." />
      <Card className="mb-6">
        <CardContent className="pt-6">
          <PatientPicker value={patient} onChange={setPatient} />
        </CardContent>
      </Card>

      {error && <ErrorBox error={errorMessage(error)} />}
      {patient && acct && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Advance balance</p>
                  <p className="text-2xl font-semibold tabular-nums">{formatINR(acct.depositBalance)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Outstanding on bills</p>
                  <p className="text-2xl font-semibold tabular-nums">{formatINR(acct.outstanding)}</p>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Bills</CardTitle>
              </CardHeader>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Bill no.</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {acct.invoices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                        No bills.
                      </TableCell>
                    </TableRow>
                  ) : (
                    acct.invoices.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell>
                          <Link className="font-mono text-xs text-primary hover:underline" href={`/billing/invoices/${i.id}`}>
                            {i.number ?? 'Draft'}
                          </Link>
                        </TableCell>
                        <TableCell>{formatDate(i.invoiceDate)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatINR(i.total)}</TableCell>
                        <TableCell className="text-right tabular-nums">{i.status === 'final' ? formatINR(i.balance) : '—'}</TableCell>
                        <TableCell>
                          <InvoiceStatusBadge inv={i} />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Advance history</CardTitle>
              </CardHeader>
              <CardContent>
                {acct.deposits.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No advances yet.</p>
                ) : (
                  <ul className="divide-y text-sm">
                    {acct.deposits.map((p) => (
                      <li key={p.id} className="flex justify-between py-2">
                        <span>
                          <span className="font-mono text-xs">{p.number}</span> ·{' '}
                          {p.kind === 'deposit' ? `Advance (${MODE_LABELS[p.mode]})` : p.kind === 'refund' ? `Refund (${MODE_LABELS[p.mode]})` : 'Used on bill'} ·{' '}
                          {formatDateTime(p.receivedAt)}
                        </span>
                        <span className="tabular-nums">{p.kind === 'deposit' ? formatINR(p.amount) : `− ${formatINR(p.amount)}`}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
          <div className="space-y-6">
            <Can permission="billing.payment.collect">
              <MoneyForm title="Take advance" action="Record advance" onSubmit={(v) => api.billing.payments.deposit({ patientId: patient.id, ...v })} onDone={refresh} />
            </Can>
            {acct.depositBalance > 0 && (
              <Can permission="billing.payment.refund">
                <MoneyForm
                  title={`Refund advance (up to ${formatINR(acct.depositBalance)})`}
                  action="Refund"
                  needsReason
                  max={acct.depositBalance}
                  maxMessage={`Advance balance is only ${formatINR(acct.depositBalance)}`}
                  onSubmit={(v) => api.billing.payments.refund({ patientId: patient.id, ...v, notes: v.notes ?? '' })}
                  onDone={refresh}
                />
              </Can>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function MoneyForm({
  title,
  action,
  needsReason,
  max,
  maxMessage,
  onSubmit,
  onDone,
}: {
  title: string;
  action: string;
  needsReason?: boolean;
  /** Most that can be entered (e.g. the advance balance for a refund). */
  max?: number;
  maxMessage?: string;
  onSubmit: (v: { mode: B.PaymentMode; amount: number; reference?: string; notes?: string }) => Promise<unknown>;
  onDone: () => void;
}) {
  const [mode, setMode] = React.useState<B.PaymentMode>('cash');
  const [amount, setAmount] = React.useState('');
  const [reference, setReference] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const v = Number(amount);
  const amountErr =
    amount.trim() === ''
      ? undefined
      : !Number.isFinite(v) || v <= 0
        ? 'Must be more than 0'
        : Math.abs(Math.round(v * 100) - v * 100) > 1e-6
          ? 'At most 2 decimal places'
          : max !== undefined && Math.round(v * 100) > Math.round(max * 100)
            ? maxMessage
            : undefined;
  const m = useMutation({
    mutationFn: () => onSubmit({ mode, amount: Number(amount), reference: reference.trim() || undefined, notes: notes.trim() || undefined }),
    onSuccess: () => {
      setAmount('');
      setReference('');
      setNotes('');
      onDone();
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ErrorBox error={m.error ? errorMessage(m.error) : null} />
        <Field label="Mode">
          <Select value={mode} onChange={(e) => setMode(e.target.value as B.PaymentMode)} aria-label="Mode">
            {B.PAYMENT_MODES.map((x) => (
              <option key={x} value={x}>
                {MODE_LABELS[x]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Amount (₹)" error={amountErr}>
          <Input type="number" min={0} max={max} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
        </Field>
        {mode !== 'cash' && (
          <Field label="Reference">
            <Input maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} aria-label="Reference" />
          </Field>
        )}
        <Field label={needsReason ? 'Reason *' : 'Notes'}>
          <Input maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
        </Field>
        <Button className="w-full" disabled={m.isPending || !(Number(amount) > 0) || !!amountErr || (needsReason && notes.trim().length < 3)} onClick={() => m.mutate()}>
          {m.isPending && <Loader2 className="animate-spin" />}
          {action}
        </Button>
      </CardContent>
    </Card>
  );
}
