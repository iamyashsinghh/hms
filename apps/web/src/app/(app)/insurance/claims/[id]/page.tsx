'use client';

import * as React from 'react';
import Link from 'next/link';
import { use } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ExternalLink, Loader2, Plus, RotateCw, Trash2 } from 'lucide-react';
import { insurance as I } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ActionForm, DEDUCTION_LABELS, DOC_LABELS, ErrorBox, Field, History, StatusBadge, formatINR, opt, todayIST } from '@/modules/insurance/ui';

const OPEN = ['submitted', 'query', 'approved', 'partially_settled'];
const KIND_LABELS: Record<I.SettlementPosting['kind'], string> = { payment: 'Receipt', tds: 'TDS', write_off: 'Write-off', recovery: 'Patient pays' };

export default function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('insurance.claim.read');
  const canManage = usePermission('insurance.claim.manage');
  const queryClient = useQueryClient();
  const key = ['insurance', 'claims', id];
  const { data: c, isPending, error } = useQuery({ queryKey: key, queryFn: () => api.insurance.claims.get(id), enabled: canRead });
  const act = useMutation({
    mutationFn: (fn: () => Promise<I.Claim>) => fn(),
    onSuccess: (next) => {
      queryClient.setQueryData(key, next);
      queryClient.invalidateQueries({ queryKey: ['insurance'], refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: ['billing'], refetchType: 'none' });
    },
  });
  const run = (fn: () => Promise<I.Claim>) => act.mutate(fn);

  if (!canRead) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  const cl = api.insurance.claims;
  const closed = ['settled', 'rejected', 'cancelled'].includes(c.status);
  const missing = c.documents.filter((d) => d.required && !d.receivedAt).length;

  return (
    <div className="space-y-6">
      <Link href="/insurance/claims" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
        <ArrowLeft /> Claims
      </Link>
      <div>
        <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
          Claim {c.number} <StatusBadge status={c.status} />
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <Link href={`/insurance/policies/${c.policyId}`} className="hover:underline">
            {c.patientName}
          </Link>{' '}
          · <span className="font-mono">{c.patientUhid}</span> · {c.payerName} · <span className="capitalize">{c.claimType}</span>
          {c.preauthId && (
            <>
              {' '}
              · pre-auth{' '}
              <Link href={`/insurance/preauths/${c.preauthId}`} className="font-mono hover:underline">
                {c.preauthNumber}
              </Link>
            </>
          )}
          {c.payerClaimNo && ` · payer claim no. ${c.payerClaimNo}`}
        </p>
      </div>

      <Can permission="insurance.claim.manage">
        <div className="flex flex-wrap gap-2">
          {(c.status === 'draft' || c.status === 'query') && (
            <ActionForm
              label={c.status === 'draft' ? 'Submit to payer' : 'Answer query and resubmit'}
              variant="default"
              fields={[
                { name: 'payerRef', label: 'Payer claim no. (optional)' },
                { name: 'note', label: 'Note (optional)' },
              ]}
              pending={act.isPending}
              onSubmit={(f) => run(() => cl.submit(id, { payerRef: opt(f.payerRef!), note: opt(f.note!) }))}
            />
          )}
          {(c.status === 'submitted' || c.status === 'query') && (
            <ActionForm
              label="Record approval"
              fields={[
                { name: 'approvedAmount', label: 'Approved ₹', type: 'number', required: true, defaultValue: String(c.claimedAmount) },
                { name: 'payerClaimNo', label: 'Payer claim no.' },
              ]}
              pending={act.isPending}
              onSubmit={(f) => run(() => cl.approve(id, { approvedAmount: Number(f.approvedAmount), payerClaimNo: opt(f.payerClaimNo!) }))}
            />
          )}
          {(c.status === 'submitted' || c.status === 'approved') && (
            <ActionForm label="Payer query" fields={[{ name: 'note', label: 'What the payer asked', required: true }]} pending={act.isPending} onSubmit={(f) => run(() => cl.query(id, { note: f.note! }))} />
          )}
          {['submitted', 'query', 'approved'].includes(c.status) && c.settledAmount + c.tdsAmount + c.deductionAmount === 0 && (
            <ActionForm label="Rejected" variant="destructive" fields={[{ name: 'note', label: 'Reason', required: true }]} pending={act.isPending} onSubmit={(f) => run(() => cl.reject(id, { note: f.note! }))} />
          )}
          {['draft', 'submitted', 'query'].includes(c.status) && c.settledAmount + c.tdsAmount + c.deductionAmount === 0 && (
            <ActionForm label="Cancel claim" variant="destructive" fields={[{ name: 'note', label: 'Reason', required: true }]} pending={act.isPending} onSubmit={(f) => run(() => cl.cancel(id, { note: f.note! }))} />
          )}
        </div>
      </Can>
      {c.status === 'draft' && missing > 0 && (
        <p className="text-sm text-muted-foreground">
          {missing} required {missing === 1 ? 'document is' : 'documents are'} still to be collected before this can be submitted.
        </p>
      )}
      <ErrorBox error={act.error ? errorMessage(act.error) : null} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Amount label="Claimed" value={c.claimedAmount} />
        <Amount label="Approved" value={c.approvedAmount} />
        <Amount label="Received (incl. TDS)" value={c.settledAmount + c.tdsAmount} />
        <Amount label="Deductions" value={c.deductionAmount} />
        <Amount label="Payer still owes" value={c.outstanding} strong />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Bills on this claim</CardTitle>
              {c.dueDate && <CardDescription>Payment due from the payer by {formatDate(c.dueDate)}.</CardDescription>}
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Bill</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Payer share</TableHead>
                  <TableHead className="text-right">Patient share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.invoices.map((b) => (
                  <TableRow key={b.invoiceId}>
                    <TableCell>
                      <Link href={`/billing/invoices/${b.invoiceId}`} className="font-mono text-xs hover:underline">
                        {b.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDate(b.invoiceDate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(b.invoiceTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(b.payerAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(b.patientAmount)}</TableCell>
                  </TableRow>
                ))}
                {c.invoices.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                      Bills were released when this claim was {c.status}.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>

          <Documents claim={c} canManage={canManage && !closed} onChange={(next) => queryClient.setQueryData(key, next)} />

          {OPEN.includes(c.status) && (
            <Can permission="insurance.settlement.record">
              <SettlementForm claim={c} onDone={(next) => queryClient.setQueryData(key, next)} />
            </Can>
          )}

          {c.settlements.length > 0 && <Settlements claim={c} onChange={(next) => queryClient.setQueryData(key, next)} />}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <History events={c.history} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Amount({ label, value, strong }: { label: string; value: number | null; strong?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`mt-1 tabular-nums ${strong ? 'text-xl font-semibold' : 'text-lg'}`}>{formatINR(value)}</div>
      </CardContent>
    </Card>
  );
}

function Documents({ claim, canManage, onChange }: { claim: I.Claim; canManage: boolean; onChange: (c: I.Claim) => void }) {
  const [adding, setAdding] = React.useState({ docType: 'other' as I.DocumentType, title: '', url: '' });
  const m = useMutation({ mutationFn: (fn: () => Promise<I.Claim>) => fn(), onSuccess: onChange });
  const cl = api.insurance.claims;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
        <CardDescription>Tick each document once it is in the claim file. Add a link if it is stored online.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {claim.documents.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm">
            <input
              type="checkbox"
              aria-label={`${d.title} received`}
              checked={!!d.receivedAt}
              disabled={!canManage || m.isPending}
              onChange={(e) => m.mutate(() => cl.updateDocument(claim.id, d.id, { received: e.target.checked }))}
            />
            <span className="flex-1">
              {d.title} {d.required && <Badge variant="outline">Required</Badge>}
              <span className="ml-2 text-xs text-muted-foreground">{DOC_LABELS[d.docType]}</span>
            </span>
            {d.url && (
              <a href={d.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                Open <ExternalLink className="inline size-3" />
              </a>
            )}
            {d.receivedAt && <span className="text-xs text-muted-foreground">{formatDate(d.receivedAt)}</span>}
            {canManage && !d.required && (
              <Button variant="ghost" size="sm" aria-label="Remove" onClick={() => m.mutate(() => cl.removeDocument(claim.id, d.id))}>
                <Trash2 />
              </Button>
            )}
          </div>
        ))}
        {canManage && (
          <form
            className="flex flex-wrap gap-2 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              m.mutate(() => cl.addDocument(claim.id, { docType: adding.docType, title: adding.title, url: adding.url.trim(), received: true }));
              setAdding({ docType: 'other', title: '', url: '' });
            }}
          >
            <Select className="w-44" value={adding.docType} aria-label="Type" onChange={(e) => setAdding({ ...adding, docType: e.target.value as I.DocumentType })}>
              {I.DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DOC_LABELS[t]}
                </option>
              ))}
            </Select>
            <Input className="min-w-48 flex-1" required placeholder="Document title" value={adding.title} onChange={(e) => setAdding({ ...adding, title: e.target.value })} />
            <Input className="min-w-48 flex-1" type="url" placeholder="Link (optional)" value={adding.url} onChange={(e) => setAdding({ ...adding, url: e.target.value })} />
            <Button type="submit" variant="outline" disabled={m.isPending}>
              <Plus /> Add
            </Button>
          </form>
        )}
        <ErrorBox error={m.error ? errorMessage(m.error) : null} />
      </CardContent>
    </Card>
  );
}

interface DeductionRow {
  category: I.DeductionCategory;
  reason: string;
  amount: string;
  recoverFromPatient: boolean;
}

function SettlementForm({ claim, onDone }: { claim: I.Claim; onDone: (c: I.Claim) => void }) {
  const [v, setV] = React.useState({ settledOn: todayIST(), reference: '', amountPaid: '', tdsAmount: '', note: '' });
  const [rows, setRows] = React.useState<DeductionRow[]>([]);
  const deductions = rows.filter((r) => r.amount.trim() !== '').reduce((a, r) => a + Number(r.amount), 0);
  const total = Number(v.amountPaid || 0) + Number(v.tdsAmount || 0) + deductions;
  const save = useMutation({
    mutationFn: () =>
      api.insurance.claims.settle(claim.id, {
        settledOn: v.settledOn,
        reference: v.reference,
        amountPaid: Number(v.amountPaid || 0),
        tdsAmount: Number(v.tdsAmount || 0),
        deductions: rows.filter((r) => r.amount.trim() !== '').map((r) => ({ ...r, amount: Number(r.amount) })),
        note: opt(v.note),
      }),
    onSuccess: (next) => {
      setV({ settledOn: todayIST(), reference: '', amountPaid: '', tdsAmount: '', note: '' });
      setRows([]);
      onDone(next);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record settlement</CardTitle>
        <CardDescription>
          The payer owes {formatINR(claim.outstanding)}. Money and TDS post as receipts on the bills; deductions are either written off (credit note) or left
          for the patient to pay.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field id="on" label="Settled on">
              <Input id="on" type="date" required value={v.settledOn} onChange={(e) => setV({ ...v, settledOn: e.target.value })} />
            </Field>
            <Field id="utr" label="UTR / cheque no.">
              <Input id="utr" required value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} />
            </Field>
            <Field id="paid" label="Amount received ₹">
              <Input id="paid" type="number" step="0.01" min={0} value={v.amountPaid} onChange={(e) => setV({ ...v, amountPaid: e.target.value })} />
            </Field>
            <Field id="tds" label="TDS deducted ₹">
              <Input id="tds" type="number" step="0.01" min={0} value={v.tdsAmount} onChange={(e) => setV({ ...v, tdsAmount: e.target.value })} />
            </Field>
          </div>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Select className="w-52" value={r.category} aria-label="Deduction type" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, category: e.target.value as I.DeductionCategory } : x)))}>
                  {I.DEDUCTION_CATEGORIES.map((d) => (
                    <option key={d} value={d}>
                      {DEDUCTION_LABELS[d]}
                    </option>
                  ))}
                </Select>
                <Input className="min-w-48 flex-1" required placeholder="Reason given by payer" value={r.reason} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)))} />
                <Input className="w-32" type="number" step="0.01" min={0} required placeholder="₹" value={r.amount} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                <label className="flex items-center gap-1 text-sm">
                  <input type="checkbox" checked={r.recoverFromPatient} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, recoverFromPatient: e.target.checked } : x)))} /> Patient pays
                </label>
                <Button type="button" variant="ghost" size="sm" aria-label="Remove deduction" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setRows([...rows, { category: 'non_payable', reason: '', amount: '', recoverFromPatient: false }])}>
              <Plus /> Add deduction
            </Button>
          </div>
          <Field id="snote" label="Note">
            <Input id="snote" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
          </Field>
          <ErrorBox error={save.error ? errorMessage(save.error) : null} />
          <div className="flex items-center justify-end gap-4">
            <span className={`text-sm tabular-nums ${total > claim.outstanding ? 'text-destructive' : 'text-muted-foreground'}`}>
              Accounts for {formatINR(total)} of {formatINR(claim.outstanding)}
            </span>
            <Button type="submit" disabled={save.isPending || total <= 0}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Check />} Record settlement
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Settlements({ claim, onChange }: { claim: I.Claim; onChange: (c: I.Claim) => void }) {
  const retry = useMutation({ mutationFn: (id: string) => api.insurance.claims.retryPosting(id), onSuccess: onChange });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Settlements</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {claim.settlements.map((s) => (
          <div key={s.id} className="space-y-2 rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium">{formatDate(s.settledOn)}</span> · {s.reference} · received {formatINR(s.amountPaid)}
                {s.tdsAmount > 0 && ` · TDS ${formatINR(s.tdsAmount)}`}
                {s.deductionAmount > 0 && ` · deductions ${formatINR(s.deductionAmount)}`}
              </span>
              {s.postingStatus === 'posted' ? (
                <Badge>Posted to billing</Badge>
              ) : (
                <span className="flex items-center gap-2">
                  <Badge variant="destructive">{s.postingStatus === 'failed' ? 'Posting failed' : 'Not posted yet'}</Badge>
                  <Can permission="insurance.settlement.record">
                    <Button variant="outline" size="sm" disabled={retry.isPending} onClick={() => retry.mutate(s.id)}>
                      <RotateCw /> Retry
                    </Button>
                  </Can>
                </span>
              )}
            </div>
            {s.postingError && <p className="text-xs text-destructive">{s.postingError}</p>}
            {s.deductions.length > 0 && (
              <ul className="text-xs text-muted-foreground">
                {s.deductions.map((d, i) => (
                  <li key={i}>
                    {DEDUCTION_LABELS[d.category]}: {d.reason} · {formatINR(d.amount)} {d.recoverFromPatient ? '(patient pays)' : '(written off)'}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2 text-xs">
              {s.postings.map((p, i) => (
                <span key={i} className="rounded bg-muted px-2 py-0.5">
                  {p.invoiceNumber} · {KIND_LABELS[p.kind]} {formatINR(p.amount)}
                  {p.billingRef && p.kind !== 'recovery' && ` · ${p.billingRef}`}
                </span>
              ))}
            </div>
          </div>
        ))}
        <ErrorBox error={retry.error ? errorMessage(retry.error) : null} />
      </CardContent>
    </Card>
  );
}
