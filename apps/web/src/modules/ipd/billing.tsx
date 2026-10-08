'use client';

// Running bill, advances and bill finalization on the admission page.
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { ipd as I } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { firstError, validate, type FieldErrors } from '@/lib/validate';
import { usePermission } from '@/lib/auth';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorBox, Field, formatDateTime, formatINR } from './ui';

export function BillTab({ admission }: { admission: I.Admission }) {
  const id = admission.id;
  const key = ['ipd', 'bill', id];
  const queryClient = useQueryClient();
  const canCharge = usePermission('ipd.charge.write');
  const canAdvance = usePermission('ipd.advance.collect');
  const canFinalize = usePermission('ipd.bill.finalize');
  const canSeeInvoice = usePermission('billing.invoice.read');
  const { data: bill, error } = useQuery({ queryKey: key, queryFn: () => api.ipd.bill.get(id) });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ['ipd', 'admission', id] });
  };

  const emptyCharge = { serviceCode: '', description: '', qty: '1', unitPrice: '' };
  const [charge, setCharge] = React.useState(emptyCharge);
  const [chargeErrors, setChargeErrors] = React.useState<FieldErrors>({});
  const addCharge = useMutation({
    mutationFn: (body: I.ChargeInput) => api.ipd.bill.addCharge(id, body),
    onSuccess: () => {
      setCharge(emptyCharge);
      refresh();
    },
  });
  const cancelCharge = useMutation({
    mutationFn: (v: { chargeId: string; reason: string }) => api.ipd.bill.cancelCharge(id, v.chargeId, { reason: v.reason }),
    onSuccess: refresh,
  });
  const [adv, setAdv] = React.useState({ amount: '', mode: 'cash' as I.AdvanceMode, reference: '' });
  const [advanceError, setAdvanceError] = React.useState<string | null>(null);
  const advance = useMutation({
    mutationFn: (body: I.AdvanceInput) => api.ipd.bill.advance(id, body),
    onSuccess: () => {
      setAdv({ amount: '', mode: 'cash', reference: '' });
      refresh();
    },
  });
  const [discount, setDiscount] = React.useState('');
  const finalize = useMutation({
    mutationFn: (body: I.FinalizeBill) => api.ipd.bill.finalize(id, body),
    onSuccess: refresh,
  });

  const running = admission.status === 'admitted' && !admission.invoiceId;
  const err = addCharge.error ?? cancelCharge.error ?? advance.error ?? finalize.error ?? error;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <ErrorBox error={err ? errorMessage(err) : null} />
        {bill && (
          <Card>
            <CardHeader className="flex flex-row items-baseline justify-between">
              <CardTitle>{bill.status === 'final' ? 'Final bill' : 'Running bill'}</CardTitle>
              {bill.invoiceId && canSeeInvoice && (
                <Link href={`/billing/invoices/${bill.invoiceId}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  Open invoice
                </Link>
              )}
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {bill.bedCharges.map((b) => (
                  <TableRow key={b.stayId}>
                    <TableCell className="whitespace-nowrap">
                      {b.dates[0]}
                      {b.days > 1 ? ` → ${b.dates[b.dates.length - 1]}` : ''}
                    </TableCell>
                    <TableCell>Bed charges · {b.bedLabel}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.days}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(b.dailyRate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(b.amount)}</TableCell>
                    <TableCell />
                  </TableRow>
                ))}
                {bill.charges.map((c) => (
                  <TableRow key={c.id} className={c.status === 'cancelled' ? 'text-muted-foreground line-through' : ''}>
                    <TableCell className="whitespace-nowrap">{c.chargeDate}</TableCell>
                    <TableCell>
                      {c.description}
                      {c.serviceCode && <span className="ml-1 font-mono text-xs text-muted-foreground">{c.serviceCode}</span>}
                      {c.taxRate > 0 && <span className="ml-1 text-xs text-muted-foreground">+{c.taxRate}% GST</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.qty}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(c.unitPrice)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(c.amount)}</TableCell>
                    <TableCell className="text-right">
                      {running && canCharge && c.status === 'active' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7"
                          onClick={() => {
                            const reason = window.prompt('Why cancel this charge?');
                            if (reason && reason.trim().length >= 3) cancelCharge.mutate({ chargeId: c.id, reason });
                          }}
                        >
                          Cancel
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="text-right font-medium">
                    {bill.status === 'final' ? 'Billed' : 'Total so far'}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatINR(bill.grossTotal)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
            {bill.status === 'running' && (
              <CardContent className="pt-4 text-xs text-muted-foreground">
                Bed charges count each night in hospital (India time), at least one day; the day of discharge is not charged.
              </CardContent>
            )}
          </Card>
        )}

        {running && canCharge && (
          <Card>
            <CardHeader>
              <CardTitle>Post a charge</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-3 sm:grid-cols-6"
                onSubmit={(e) => {
                  e.preventDefault();
                  const body: I.ChargeInput = {
                    serviceCode: charge.serviceCode || undefined,
                    description: charge.description || undefined,
                    qty: String(charge.qty).trim() === '' ? 1 : charge.qty,
                    unitPrice: charge.unitPrice === '' ? undefined : charge.unitPrice,
                  };
                  const { errors: found } = validate(I.chargeInputSchema, body);
                  setChargeErrors(found ?? {});
                  if (!found) addCharge.mutate(body);
                }}
              >
                <Field id="c-code" label="Service code">
                  <Input id="c-code" value={charge.serviceCode} onChange={(e) => setCharge({ ...charge, serviceCode: e.target.value })} placeholder="Optional" maxLength={40} />
                </Field>
                <Field id="c-desc" label="Description" className="sm:col-span-2" error={chargeErrors.description}>
                  <Input id="c-desc" value={charge.description} onChange={(e) => setCharge({ ...charge, description: e.target.value })} maxLength={300} />
                </Field>
                <Field id="c-qty" label="Qty" error={chargeErrors.qty}>
                  <Input id="c-qty" type="number" min={0.01} max={10000} step="any" value={charge.qty} onChange={(e) => setCharge({ ...charge, qty: e.target.value })} />
                </Field>
                <Field id="c-price" label="Rate (₹)" error={chargeErrors.unitPrice}>
                  <Input id="c-price" type="number" min={0} step="0.01" value={charge.unitPrice} onChange={(e) => setCharge({ ...charge, unitPrice: e.target.value })} />
                </Field>
                <div className="flex items-end">
                  <Button type="submit" className="w-full" disabled={addCharge.isPending}>
                    Add
                  </Button>
                </div>
              </form>
              {chargeErrors._form && <p className="mt-2 text-xs text-destructive">{chargeErrors._form}</p>}
              <p className="mt-2 text-xs text-muted-foreground">With a service code, the rate and GST come from the price list unless you type a rate.</p>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-6">
        {bill && (
          <Card>
            <CardContent className="space-y-2 pt-6 text-sm">
              <Row label="Bed charges" value={formatINR(bill.bedTotal)} />
              <Row label="Other charges" value={formatINR(bill.chargesTotal)} />
              <Row label="Total" value={formatINR(bill.grossTotal)} strong />
              <Row label="Advance taken (this stay)" value={`− ${formatINR(bill.advanceTotal)}`} />
              <Row
                label={bill.estimatedDue >= 0 ? 'Estimated due' : 'Estimated refund'}
                value={formatINR(Math.abs(bill.estimatedDue))}
                strong
              />
              <p className="pt-2 text-xs text-muted-foreground">Unused advance with billing: {formatINR(bill.depositBalance)}</p>
            </CardContent>
          </Card>
        )}

        {running && canAdvance && (
          <Card>
            <CardHeader>
              <CardTitle>Take advance</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Field id="a-amt" label="Amount (₹)" error={advanceError ?? undefined}>
                <Input id="a-amt" type="number" min={0} step="0.01" value={adv.amount} onChange={(e) => setAdv({ ...adv, amount: e.target.value })} />
              </Field>
              <Field id="a-mode" label="Mode">
                <Select id="a-mode" value={adv.mode} onChange={(e) => setAdv({ ...adv, mode: e.target.value as I.AdvanceMode })}>
                  {I.ADVANCE_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m.toUpperCase()}
                    </option>
                  ))}
                </Select>
              </Field>
              {adv.mode !== 'cash' && (
                <Field id="a-ref" label="Reference / UTR">
                  <Input id="a-ref" value={adv.reference} onChange={(e) => setAdv({ ...adv, reference: e.target.value })} maxLength={100} />
                </Field>
              )}
              <Button
                disabled={advance.isPending || !(Number(adv.amount) > 0)}
                onClick={() => {
                  const body: I.AdvanceInput = { amount: adv.amount, mode: adv.mode, reference: adv.reference || undefined };
                  const { errors: found } = validate(I.advanceInputSchema, body);
                  setAdvanceError(firstError(found));
                  if (!found) advance.mutate(body);
                }}
              >
                {advance.isPending && <Loader2 className="animate-spin" />} Record advance
              </Button>
            </CardContent>
          </Card>
        )}

        {bill && bill.advances.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Advances</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {bill.advances.map((a) => (
                  <li key={a.id} className="flex justify-between py-2">
                    <span>
                      <span className="font-mono text-xs">{a.receiptNo}</span> · {a.mode.toUpperCase()} · {formatDateTime(a.receivedAt)}
                    </span>
                    <span className="tabular-nums">{formatINR(a.amount)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {running && canFinalize && (
          <Card>
            <CardHeader>
              <CardTitle>Finalize bill</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <p className="text-sm text-muted-foreground">Makes one final invoice of everything above and adjusts the patient&apos;s advance. Charges are locked after this.</p>
              <Field id="f-disc" label="Discount on bed charges (₹, optional)">
                <Input id="f-disc" type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </Field>
              <Button
                disabled={finalize.isPending}
                onClick={() => {
                  if (window.confirm('Finalize the IPD bill? Charges cannot be changed afterwards.')) {
                    finalize.mutate({ discount: Number(discount) > 0 ? Number(discount) : undefined });
                  }
                }}
              >
                {finalize.isPending && <Loader2 className="animate-spin" />} Finalize bill
              </Button>
              {finalize.data && (
                <p className="text-sm">
                  Invoice {finalize.data.number}: {formatINR(finalize.data.total)}, advance adjusted {formatINR(finalize.data.advanceAdjusted)}, due {formatINR(finalize.data.balanceDue)}.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'border-t pt-2 font-semibold' : ''}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
