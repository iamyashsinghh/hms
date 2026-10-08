'use client';

// Running bill, advances and bill finalization on the admission page. The bill shows every charge of the stay
// on the patient account (posted here, or by pharmacy, the store, lab...) plus bed days, counted by the
// hospital's room-rent day rule.
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Search, X } from 'lucide-react';
import { ipd as I, type billing as B } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { firstError, validate, type FieldErrors } from '@/lib/validate';
import { usePermission } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebounced } from '@/modules/billing/ui';
import { ErrorBox, Field, formatDateTime, formatINR } from './ui';

/** Who posted a charge, in words the ward understands. */
const SOURCE_LABELS: Record<string, string> = {
  ipd: 'IPD',
  pharmacy: 'Pharmacy',
  inventory: 'Store',
  lab: 'Lab',
  radiology: 'Radiology',
  emr: 'Doctor',
  billing: 'Billing desk',
  frontoffice: 'Front office',
};

const ROOM_RENT_NOTES: Record<I.RunningBill['roomRentDay'], (checkout: string) => string> = {
  midnight: () => 'Bed charges count each calendar day in hospital (India time), at least one day; the day of discharge is not charged.',
  admission_time: () => 'Bed charges count each started 24 hours from the admission time, at least one day.',
  checkout_time: (t) => `Bed charges count a day up to ${t} on the day after admission, and one more day each time ${t} passes.`,
};

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
  const err = cancelCharge.error ?? advance.error ?? finalize.error ?? error;
  const invoiceLink = (invoiceId: string | null, number: string | null) =>
    invoiceId && canSeeInvoice ? (
      <Link href={`/billing/invoices/${invoiceId}`} className="font-mono underline-offset-2 hover:underline">
        {number ?? 'bill'}
      </Link>
    ) : (
      <span className="font-mono">{number ?? 'bill'}</span>
    );

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="min-w-0 space-y-6 lg:col-span-2">
        <ErrorBox error={err ? errorMessage(err) : null} />
        {bill?.preauth && <PreauthEstimate preauth={bill.preauth} total={bill.grossTotal} />}
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
            <div className="overflow-x-auto">
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
                  {bill.charges.map((c) => {
                    const elsewhere = c.status === 'billed' && c.invoiceId !== bill.invoiceId;
                    return (
                      <TableRow key={c.id} className={c.status === 'cancelled' ? 'text-muted-foreground line-through' : elsewhere ? 'text-muted-foreground' : ''}>
                        <TableCell className="whitespace-nowrap">{c.chargeDate}</TableCell>
                        <TableCell>
                          <span>{c.description}</span>
                          {c.serviceCode && <span className="ml-1 font-mono text-xs text-muted-foreground">{c.serviceCode}</span>}
                          {c.taxRate > 0 && (
                            <span className="ml-1 text-xs text-muted-foreground">{c.priceIncludesTax ? `incl. ${c.taxRate}% GST` : `+${c.taxRate}% GST`}</span>
                          )}
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground no-underline">
                            <Badge variant="secondary">{SOURCE_LABELS[c.sourceModule] ?? c.sourceModule}</Badge>
                            {elsewhere && <span>Billed separately on {invoiceLink(c.invoiceId, c.invoiceNumber)}</span>}
                            {c.status === 'cancelled' && c.cancelReason && <span>Cancelled: {c.cancelReason}</span>}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{c.qty}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatINR(c.unitPrice)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatINR(c.amount)}</TableCell>
                        <TableCell className="text-right">
                          {running && canCharge && c.status === 'pending' && c.sourceModule === 'ipd' && (
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
                    );
                  })}
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={4} className="text-right font-medium">
                      {bill.status === 'final' ? 'Billed' : 'Total so far'}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatINR(bill.grossTotal)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            {bill.status === 'running' && (
              <CardContent className="space-y-1 pt-4 text-xs text-muted-foreground">
                <p>{ROOM_RENT_NOTES[bill.roomRentDay](bill.checkoutTime)}</p>
                <p>Medicines, consumables and tests for this stay join the bill on their own. Return a medicine in Pharmacy to take it off.</p>
              </CardContent>
            )}
          </Card>
        )}

        {running && canCharge && <PostCharge admissionId={id} onPosted={refresh} />}
      </div>

      <div className="min-w-0 space-y-6">
        {bill && (
          <Card>
            <CardContent className="space-y-2 pt-6 text-sm">
              <Row label="Bed charges" value={formatINR(bill.bedTotal)} />
              <Row label="Other charges" value={formatINR(bill.chargesTotal)} />
              <Row label="Total" value={formatINR(bill.grossTotal)} strong />
              <Row label="Advance taken (this stay)" value={`− ${formatINR(bill.advanceTotal)}`} />
              <Row label={bill.estimatedDue >= 0 ? 'Estimated due' : 'Estimated refund'} value={formatINR(Math.abs(bill.estimatedDue))} strong />
              {bill.billedElsewhereTotal > 0 && (
                <p className="pt-2 text-xs text-muted-foreground">Billed separately during the stay (not in the total): {formatINR(bill.billedElsewhereTotal)}</p>
              )}
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
                  <li key={a.id} className="flex justify-between gap-2 py-2">
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
              <p className="text-sm text-muted-foreground">
                Makes one final invoice of everything above (bed days and every pending charge of the stay) and adjusts the patient&apos;s advance. Charges are
                locked after this.
              </p>
              <Field id="f-disc" label="Bill discount (₹, optional)">
                <Input id="f-disc" type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </Field>
              <p className="text-xs text-muted-foreground">A discount above the hospital&apos;s limit needs the discount-override permission.</p>
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
                  Invoice {finalize.data.number}: {formatINR(finalize.data.total)}, advance adjusted {formatINR(finalize.data.advanceAdjusted)}, due{' '}
                  {formatINR(finalize.data.balanceDue)}.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/** "Estimate vs actual": the approved pre-auth against the running total, with a warning once it is passed. */
function PreauthEstimate({ preauth, total }: { preauth: I.PreauthEstimate; total: number }) {
  const over = preauth.overBy > 0;
  const near = !over && preauth.usedPct >= 80;
  const tone = over
    ? 'border-destructive/40 bg-destructive/5'
    : near
      ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'
      : '';
  return (
    <Card className={tone}>
      <CardContent className="space-y-3 pt-6 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-medium">
            Pre-auth{' '}
            <Link href={`/insurance/preauths/${preauth.preauthId}`} className="font-mono underline-offset-2 hover:underline">
              {preauth.number}
            </Link>
            {preauth.payerName && <span className="text-muted-foreground"> · {preauth.payerName}</span>}
          </span>
          <span className="tabular-nums text-muted-foreground">{preauth.usedPct}% used</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="presentation">
          <div
            className={`h-full rounded-full ${over ? 'bg-destructive' : near ? 'bg-amber-500' : 'bg-primary'}`}
            style={{ width: `${Math.min(100, preauth.usedPct)}%` }}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-xs text-muted-foreground">Approved (estimate)</div>
            <div className="font-semibold tabular-nums">{formatINR(preauth.approvedAmount)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Running bill (actual)</div>
            <div className="font-semibold tabular-nums">{formatINR(total)}</div>
          </div>
        </div>
        {over && (
          <p className="flex items-start gap-2 text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            The bill is {formatINR(preauth.overBy)} above the approved amount. Ask the insurer for an enhancement, or tell the family the difference is theirs to pay.
          </p>
        )}
        {near && <p className="text-amber-800 dark:text-amber-200">The bill is close to the approved amount.</p>}
      </CardContent>
    </Card>
  );
}

/** "Post a charge": search the service master by name; the rate and GST fill in from the price list. */
function PostCharge({ admissionId, onPosted }: { admissionId: string; onPosted: () => void }) {
  const [service, setService] = React.useState<B.Service | null>(null);
  const [term, setTerm] = React.useState('');
  const q = useDebounced(term.trim());
  const empty = { description: '', qty: '1', unitPrice: '' };
  const [charge, setCharge] = React.useState(empty);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const { data: found, isFetching } = useQuery({
    queryKey: ['ipd', 'services', q],
    queryFn: () => api.ipd.bill.services(q),
    enabled: !service && q.length >= 2,
  });
  const add = useMutation({
    mutationFn: (body: I.ChargeInput) => api.ipd.bill.addCharge(admissionId, body),
    onSuccess: () => {
      setService(null);
      setTerm('');
      setCharge(empty);
      onPosted();
    },
  });
  const pick = (s: B.Service) => {
    setService(s);
    setCharge({ ...charge, description: s.name, unitPrice: String(s.basePrice) });
    setTerm('');
  };
  const listPrice = service ? String(service.basePrice) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Post a charge</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ErrorBox error={add.error ? errorMessage(add.error) : null} />
        <Field id="c-search" label="Service">
          {service ? (
            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                {service.name} <span className="font-mono text-xs text-muted-foreground">{service.code}</span>
                {service.taxRate > 0 && <span className="ml-1 text-xs text-muted-foreground">+{service.taxRate}% GST</span>}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7"
                aria-label="Pick another service"
                onClick={() => {
                  setService(null);
                  setCharge(empty);
                }}
              >
                <X className="size-4" />
              </Button>
            </div>
          ) : (
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="c-search"
                className="pl-8"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Search by name, e.g. nebulization, dressing…"
                autoComplete="off"
              />
              {q.length >= 2 && (
                <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-background shadow-md">
                  {isFetching && !found && <p className="p-3 text-sm text-muted-foreground">Searching…</p>}
                  {found?.items.length === 0 && <p className="p-3 text-sm text-muted-foreground">No service found. Type a description and rate below instead.</p>}
                  {found?.items.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => pick(s)}
                    >
                      <span className="min-w-0 truncate">
                        {s.name} <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
                      </span>
                      <span className="shrink-0 tabular-nums">{formatINR(s.basePrice)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Field>
        <form
          className="grid gap-3 sm:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            const body: I.ChargeInput = {
              serviceCode: service?.code,
              description: charge.description || undefined,
              qty: String(charge.qty).trim() === '' ? 1 : charge.qty,
              // Leave the list price to the server (so the patient's insurer rates apply); a changed rate is an override.
              unitPrice: charge.unitPrice === '' || charge.unitPrice === listPrice ? undefined : charge.unitPrice,
            };
            const { errors: found } = validate(I.chargeInputSchema, body);
            setErrors(found ?? {});
            if (!found) add.mutate(body);
          }}
        >
          <Field id="c-desc" label="Description" className="sm:col-span-3" error={errors.description}>
            <Input id="c-desc" value={charge.description} onChange={(e) => setCharge({ ...charge, description: e.target.value })} maxLength={300} />
          </Field>
          <Field id="c-qty" label="Qty" error={errors.qty}>
            <Input id="c-qty" type="number" min={0.01} max={10000} step="any" value={charge.qty} onChange={(e) => setCharge({ ...charge, qty: e.target.value })} />
          </Field>
          <Field id="c-price" label="Rate (₹)" error={errors.unitPrice}>
            <Input id="c-price" type="number" min={0} step="0.01" value={charge.unitPrice} onChange={(e) => setCharge({ ...charge, unitPrice: e.target.value })} />
          </Field>
          <div className="flex items-end">
            <Button type="submit" className="w-full" disabled={add.isPending}>
              {add.isPending && <Loader2 className="animate-spin" />} Add
            </Button>
          </div>
        </form>
        {errors._form && <p className="text-xs text-destructive">{errors._form}</p>}
        <p className="text-xs text-muted-foreground">
          Pick a service and the rate and GST come from the price list. Changing the rate of a listed service needs the price-override permission.
        </p>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${strong ? 'border-t pt-2 font-semibold' : ''}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
