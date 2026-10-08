'use client';

import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, Loader2, Plus, Search, X, XCircle } from 'lucide-react';
import { integrations as I, type billing as B } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { firstError, validate } from '@/lib/validate';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  CopyBox,
  ErrorBox,
  Field,
  MessageRow,
  Notice,
  Pager,
  PatientName,
  StatusBadge,
  formatDateTime,
  formatINR,
  useDebounced,
  useIntegrationSettings,
} from '@/modules/integrations/ui';

const PAGE_SIZE = 25;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pick a finalized bill with a balance (search by bill no, patient, UHID), or paste a bill id. */
function InvoicePicker({ value, onChange }: { value: B.InvoiceSummary | string | null; onChange: (v: B.InvoiceSummary | string | null) => void }) {
  const canSearch = usePermission('billing.invoice.read');
  const [term, setTerm] = React.useState('');
  const q = useDebounced(term.trim());
  const isId = UUID_RE.test(q);
  const { data, isFetching } = useQuery({
    queryKey: ['billing', 'invoices', { q, status: 'final', picker: true }],
    queryFn: () => api.billing.invoices.list({ q, status: 'final', pageSize: 10 }),
    enabled: canSearch && !value && q.length >= 2 && !isId,
  });

  if (value) {
    return (
      <div>
        <Label>Bill</Label>
        <div className="mt-2 flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
          {typeof value === 'string' ? (
            <span className="font-mono text-xs">{value}</span>
          ) : (
            <span>
              <span className="font-medium">{value.number ?? 'Draft'}</span> · {value.patientName} <span className="font-mono text-xs text-muted-foreground">{value.patientUhid}</span>{' '}
              · balance <span className="font-medium">{formatINR(value.balance)}</span>
            </span>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)} aria-label="Change bill">
            <X />
          </Button>
        </div>
      </div>
    );
  }

  const items = (data?.items ?? []).filter((i) => i.balance > 0);
  return (
    <div className="relative">
      <Label htmlFor="invoice-search">Bill</Label>
      <div className="relative mt-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="invoice-search"
          className="pl-9"
          placeholder={canSearch ? 'Bill no, patient name, UHID or paste a bill id…' : 'Paste the bill id'}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          autoComplete="off"
        />
      </div>
      {q.length >= 2 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-card shadow-lg">
          {isId ? (
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => {
                onChange(q);
                setTerm('');
              }}
            >
              Use bill id <span className="font-mono text-xs">{q}</span>
            </button>
          ) : !canSearch ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Paste the full bill id.</p>
          ) : isFetching && !data ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
          ) : items.length ? (
            items.map((inv) => (
              <button
                key={inv.id}
                type="button"
                className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onChange(inv);
                  setTerm('');
                }}
              >
                <span>
                  <span className="font-medium">{inv.number}</span> · {inv.patientName} <span className="font-mono text-xs text-muted-foreground">{inv.patientUhid}</span>
                  <span className="block text-xs text-muted-foreground">{formatDate(inv.invoiceDate)}</span>
                </span>
                <span className="text-right tabular-nums">
                  {formatINR(inv.balance)}
                  <span className="block text-xs text-muted-foreground">of {formatINR(inv.total)}</span>
                </span>
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-sm text-muted-foreground">No finalized bills with a balance.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function PaymentsPage() {
  const canRead = usePermission('integrations.payment.read');
  const canCreate = usePermission('integrations.payment.create');
  const queryClient = useQueryClient();
  const settings = useIntegrationSettings();
  const [status, setStatus] = React.useState<I.PaymentIntentStatus | 'all'>('all');
  const [page, setPage] = React.useState(1);
  const [showForm, setShowForm] = React.useState(false);
  const [invoice, setInvoice] = React.useState<B.InvoiceSummary | string | null>(null);
  const [amount, setAmount] = React.useState('');
  const [created, setCreated] = React.useState<I.PaymentIntent | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);

  const query: I.PaymentIntentQuery = { status, page, pageSize: PAGE_SIZE };
  const { data, isPending, error } = useQuery({
    queryKey: ['integrations', 'payments', query],
    queryFn: () => api.integrations.payments.list(query),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['integrations', 'payments'] });
    queryClient.invalidateQueries({ queryKey: ['billing'] });
  };
  const create = useMutation({
    mutationFn: () =>
      api.integrations.payments.create({
        invoiceId: typeof invoice === 'string' ? invoice : invoice!.id,
        amount: amount.trim() ? Number(amount) : undefined,
      }),
    onSuccess: (p) => {
      setCreated(p);
      setShowForm(false);
      setInvoice(null);
      setAmount('');
      invalidate();
    },
  });
  const action = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: 'cancel' | 'success' | 'failure' }) =>
      kind === 'cancel' ? api.integrations.payments.cancel(id) : api.integrations.payments.mockComplete(id, { outcome: kind }),
    onSettled: invalidate,
  });

  if (!canRead) return <NoAccess />;
  const busy = (id: string) => action.isPending && action.variables?.id === id;

  return (
    <>
      <PageHeader
        title="Online payments"
        description="Payment links for bills. When the patient pays, the money is posted to the bill in Billing automatically."
        actions={
          <Can permission="integrations.payment.create">
            <Button
              onClick={() => {
                setShowForm(true);
                setCreated(null);
              }}
            >
              <Plus /> New payment link
            </Button>
          </Can>
        }
      />

      {settings?.paymentProvider === 'none' && <Notice tone="warn" className="mb-4">Online payments are switched off in Integration settings.</Notice>}

      {created && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Payment link created for {formatINR(created.amount)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {created.checkout.payUrl ? (
              <>
                <p className="text-muted-foreground">Share this link with the patient:</p>
                <CopyBox value={created.checkout.payUrl} />
              </>
            ) : (
              <p className="text-muted-foreground">
                Gateway order <span className="font-mono">{created.checkout.orderId}</span>
                {created.checkout.keyId && <> (key {created.checkout.keyId})</>}. Open checkout from the patient-facing app.
              </p>
            )}
            <Button variant="outline" size="sm" onClick={() => setCreated(null)}>
              Done
            </Button>
          </CardContent>
        </Card>
      )}

      {showForm && canCreate && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>New payment link</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault();
                const invoiceId = typeof invoice === 'string' ? invoice.trim() : invoice?.id;
                const v = validate(I.createPaymentIntentSchema, { invoiceId, amount: amount.trim() ? amount : undefined });
                let message = invoiceId ? firstError(v.errors) : 'Pick a bill';
                if (v.errors?.invoiceId) message = 'Pick a bill from the list';
                if (!message && v.data?.amount !== undefined && invoice && typeof invoice !== 'string' && v.data.amount > invoice.balance) {
                  message = `Only ₹${invoice.balance.toFixed(2)} is due on this bill`;
                }
                setFormError(message);
                if (!message) create.mutate();
              }}
            >
              <div className="sm:col-span-3">
                <ErrorBox error={formError ?? (create.error ? errorMessage(create.error) : null)} />
              </div>
              <div className="sm:col-span-2">
                <InvoicePicker value={invoice} onChange={setInvoice} />
              </div>
              <Field id="amount" label="Amount (₹)" hint="Leave blank to collect the full balance.">
                <Input id="amount" type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={invoice && typeof invoice !== 'string' ? String(invoice.balance) : ''} />
              </Field>
              <div className="flex justify-end gap-2 sm:col-span-3">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!invoice || create.isPending}>
                  {create.isPending && <Loader2 className="animate-spin" />}
                  Create link
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <Select
            className="w-44"
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as typeof status);
              setPage(1);
            }}
          >
            <option value="all">All statuses</option>
            <option value="created">Awaiting payment</option>
            <option value="paid">Paid</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </Select>
          {action.error && <ErrorBox error={errorMessage(action.error)} />}
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Created</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Posted to bill</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {error ? (
              <MessageRow colSpan={7} error>
                {errorMessage(error)}
              </MessageRow>
            ) : isPending ? (
              <MessageRow colSpan={7}>Loading…</MessageRow>
            ) : data.items.length === 0 ? (
              <MessageRow colSpan={7}>No payment links.</MessageRow>
            ) : (
              data.items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-xs">{formatDateTime(p.createdAt)}</TableCell>
                  <TableCell>
                    <PatientName id={p.patientId} />
                    <span className="block font-mono text-xs text-muted-foreground">{p.providerOrderId}</span>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatINR(p.amount)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{p.provider === 'mock' ? 'Mock' : 'Razorpay'}</Badge>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={p.status} label={p.status === 'created' ? 'Awaiting payment' : undefined} />
                    {p.paidAt && <span className="block text-xs text-muted-foreground">{formatDateTime(p.paidAt)}</span>}
                    {p.failureReason && <span className="block max-w-xs text-xs text-destructive">{p.failureReason}</span>}
                  </TableCell>
                  <TableCell>
                    {p.status === 'paid' ? (
                      <>
                        <StatusBadge status={p.settlementStatus} label={p.settlementStatus === 'recorded' ? 'Posted' : undefined} />
                        {p.settlementError && <span className="block max-w-xs text-xs text-destructive">{p.settlementError}</span>}
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {p.checkout.payUrl && p.status === 'created' && (
                        <a href={p.checkout.payUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md px-3 text-xs hover:bg-muted">
                          <ExternalLink className="size-4" /> Pay link
                        </a>
                      )}
                      {canCreate && p.status === 'created' && p.provider === 'mock' && (
                        <>
                          <Button variant="ghost" size="sm" disabled={busy(p.id)} onClick={() => action.mutate({ id: p.id, kind: 'success' })}>
                            <CheckCircle2 /> Simulate success
                          </Button>
                          <Button variant="ghost" size="sm" disabled={busy(p.id)} onClick={() => action.mutate({ id: p.id, kind: 'failure' })}>
                            <XCircle /> Simulate failure
                          </Button>
                        </>
                      )}
                      {canCreate && p.status === 'created' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy(p.id)}
                          onClick={() => {
                            if (window.confirm('Cancel this payment link?')) action.mutate({ id: p.id, kind: 'cancel' });
                          }}
                        >
                          {busy(p.id) && action.variables?.kind === 'cancel' ? <Loader2 className="animate-spin" /> : null}
                          Cancel
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {data && <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
    </>
  );
}
