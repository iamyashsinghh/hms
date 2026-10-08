'use client';

// The billing desk: find the patient, check the pending charges every department posted, collect.
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { billing as B, type Patient } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth, usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SuggestedCredits } from '@/modules/billing/reversals';
import { ServiceSearch } from '@/modules/billing/service-search';
import { ACCOUNT_LABELS, ErrorBox, Field, MODE_LABELS, PatientPicker, formatDateTime, formatINR, sourceLabel } from '@/modules/billing/ui';

interface Extra {
  key: number;
  service: B.Service;
  qty: string;
  /** Typed price (needs billing.price.override); blank = price list. */
  price: string;
}

interface EstLine {
  qty: number;
  unitPrice: number;
  taxRate: number;
  discount: number;
  priceIncludesTax: boolean;
}

let nextKey = 1;
const paise = (v: number) => Math.round(v * 100);

/**
 * What the bill will come to, worked out like the server does: the bill discount is spread over the
 * lines (largest first) before GST. Exact for posted charges; desk items use the base price, so the
 * total is an estimate when one is added.
 */
function estimate(lines: EstLine[], billDiscount: number): number {
  const ls = lines.map((l) => ({ ...l, discount: paise(l.discount) }));
  let left = paise(billDiscount);
  // Same order as the server (it compares rupee price against paise discount; kept identical on purpose).
  for (const l of [...ls].sort((a, b) => b.qty * b.unitPrice - b.discount - (a.qty * a.unitPrice - a.discount))) {
    const take = Math.max(0, Math.min(left, Math.round(l.qty * paise(l.unitPrice)) - l.discount));
    l.discount += take;
    left -= take;
  }
  const total = ls.reduce((s, l) => {
    const net = Math.max(0, Math.round(l.qty * paise(l.unitPrice)) - l.discount);
    return s + (l.priceIncludesTax ? net : Math.round(net * (1 + l.taxRate / 100)));
  }, 0);
  return total / 100;
}

/** Ticks or unticks a whole visit; shows a dash when only some of its charges are ticked. */
function GroupCheckbox({ checked, mixed, onChange, label }: { checked: boolean; mixed: boolean; onChange: (v: boolean) => void; label: string }) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return <input ref={ref} type="checkbox" className="size-4" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />;
}

/** Patient picker plus the patients waiting to be billed, when no patient is chosen yet. */
export function BillPatientStart({ onPick }: { onPick: (patientId: string) => void }) {
  const [patient, setPatient] = React.useState<Patient | null>(null);
  const { data } = useQuery({ queryKey: ['billing', 'unbilled', { pageSize: 8 }], queryFn: () => api.billing.charges.unbilled({ pageSize: 8 }) });
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <PatientPicker
            label="Find the patient"
            value={patient}
            onChange={(p) => {
              setPatient(p);
              if (p) onPick(p.id);
            }}
          />
        </CardContent>
      </Card>
      {!!data?.items.length && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Waiting to be billed</CardTitle>
            <Link href="/billing/unbilled" className="text-sm text-primary hover:underline">
              All unbilled ({data.total})
            </Link>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {data.items.map((u) => (
              <button key={u.patientId} type="button" className="flex w-full items-center justify-between gap-3 px-6 py-3 text-left text-sm hover:bg-muted" onClick={() => onPick(u.patientId)}>
                <span className="min-w-0">
                  <span className="font-medium">{u.patientName}</span> <span className="font-mono text-xs text-muted-foreground">{u.uhid}</span>
                  <span className="block text-xs text-muted-foreground">
                    {u.accounts.map((a) => ACCOUNT_LABELS[a]).join(', ')} · {u.pendingCount} {u.pendingCount === 1 ? 'charge' : 'charges'} · since {formatDateTime(u.oldestChargeAt)}
                  </span>
                </span>
                <span className="shrink-0 font-medium tabular-nums">{formatINR(u.pendingTotal)}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** One patient's account: pending charges (all ticked), desk items, discount, advance and payment. */
export function BillPatient({ patientId, onChangePatient }: { patientId: string; onChangePatient: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const canFinalize = usePermission('billing.invoice.finalize');
  const canCollect = usePermission('billing.payment.collect');
  const canOverridePrice = usePermission('billing.price.override');
  const canOverrideDiscount = usePermission('billing.discount.override');
  const canReadRules = usePermission('billing.service.read');
  const canReadPayers = usePermission('insurance.payer.read');

  const { data, isPending, error } = useQuery({
    queryKey: ['billing', 'charges', 'patient', patientId],
    queryFn: () => api.billing.charges.forPatient(patientId),
  });
  const { data: payer } = useQuery({
    queryKey: ['insurance', 'payers', data?.payerId],
    queryFn: () => api.insurance.payers.get(data!.payerId!),
    enabled: !!data?.payerId && canReadPayers,
  });
  const { facility } = useAuth();
  const { data: rules } = useQuery({
    queryKey: ['billing', 'rules', facility?.id ?? 'hospital'],
    queryFn: () => api.billing.rules.get(facility?.id),
    enabled: canReadRules && !canOverrideDiscount,
  });

  // Unticked charges stay on the account for later; anything new that arrives is ticked.
  const [skipped, setSkipped] = React.useState<Set<string>>(new Set());
  const [extras, setExtras] = React.useState<Extra[]>([]);
  const [adding, setAdding] = React.useState(false);
  const [discount, setDiscount] = React.useState('');
  const [useAdvance, setUseAdvance] = React.useState<boolean | null>(null);
  const [mode, setMode] = React.useState<B.PaymentMode>('cash');
  const [reference, setReference] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [formError, setFormError] = React.useState<string | null>(null);

  const charges = React.useMemo(() => (data?.groups ?? []).flatMap((g) => g.charges), [data]);
  const picked = charges.filter((c) => !skipped.has(c.id));
  const toggle = (ids: string[], on: boolean) =>
    setSkipped((s) => {
      const next = new Set(s);
      for (const id of ids) {
        if (on) next.delete(id);
        else next.add(id);
      }
      return next;
    });

  const discountValue = discount.trim() === '' ? 0 : Number(discount);
  const discountError =
    discount.trim() === ''
      ? undefined
      : !Number.isFinite(discountValue) || discountValue < 0
        ? 'Enter an amount'
        : Math.abs(paise(discountValue) - discountValue * 100) > 1e-6
          ? 'At most 2 decimal places'
          : undefined;
  const extraErrors = extras.some((e) => !(Number(e.qty) > 0) || (e.price.trim() !== '' && !(Number(e.price) >= 0)));

  const lines: EstLine[] = [
    ...picked.map((c) => ({ qty: c.qty, unitPrice: c.unitPrice, taxRate: c.taxRate, discount: c.discount, priceIncludesTax: c.priceIncludesTax })),
    ...extras.map((e) => ({
      qty: Number(e.qty) || 0,
      unitPrice: e.price.trim() !== '' ? Number(e.price) || 0 : e.service.basePrice,
      taxRate: e.service.taxRate,
      discount: 0,
      priceIncludesTax: false,
    })),
  ];
  const exactCharges = picked.reduce((s, c) => s + paise(c.amount), 0) / 100;
  // Desk items are priced by the server from the price lists; the screen only knows the base price.
  const approximate = extras.length > 0;
  const total = extras.length || discountValue ? estimate(lines, discountError ? 0 : discountValue) : exactCharges;
  const advance = data?.depositBalance ?? 0;
  const applyAdvance = canCollect && advance > 0 && (useAdvance ?? true);
  const fromAdvance = applyAdvance ? Math.min(advance, total) : 0;
  const due = Math.max(0, Math.round((total - fromAdvance) * 100) / 100);
  const discountLimit = rules && !canOverrideDiscount ? rules.effective.maxDiscountPct : null;

  const bill = useMutation({
    mutationFn: (collect: boolean) =>
      api.billing.charges.bill({
        patientId,
        chargeIds: picked.map((c) => c.id),
        extraLines: extras.map((e) => ({
          serviceCode: e.service.code,
          qty: Number(e.qty),
          unitPrice: e.price.trim() !== '' ? Number(e.price) : undefined,
        })),
        discount: discountValue > 0 ? discountValue : undefined,
        useDeposit: applyAdvance,
        // The server collects exactly what is due on the final bill (round-off, payer prices on desk items).
        payDue: collect && due > 0 ? { mode, ref: reference.trim() || undefined } : undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: (inv) => {
      queryClient.invalidateQueries({ queryKey: ['billing'] });
      router.push(`/billing/invoices/${inv.id}`);
    },
  });

  const submit = (collect: boolean) => {
    setFormError(null);
    if (!picked.length && !extras.length) return setFormError('Tick at least one charge or add an item.');
    if (discountError) return setFormError(`Discount: ${discountError}`);
    if (extraErrors) return setFormError('Each added item needs a quantity more than 0 and a price of zero or more.');
    if (collect && due > 0 && mode !== 'cash' && !reference.trim() && mode !== 'card') {
      return setFormError(`Enter the ${mode === 'upi' ? 'UPI transaction' : mode === 'cheque' ? 'cheque' : 'bank transfer'} reference.`);
    }
    bill.mutate(collect);
  };

  if (isPending) return <p className="text-sm text-muted-foreground">Loading charges…</p>;
  if (error) return <ErrorBox error={errorMessage(error)} />;

  const nothing = !charges.length && !extras.length;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <div>
              <div className="text-lg font-semibold">{data.patientName}</div>
              <div className="text-sm text-muted-foreground">
                <span className="font-mono">{data.uhid}</span>
                {data.mobile && ` · ${data.mobile}`}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {data.payerId && <Badge variant="default">{payer ? `${payer.name}: payer rates apply` : 'Insurance / corporate rates apply'}</Badge>}
                {advance > 0 && <Badge variant="accent">Advance {formatINR(advance)}</Badge>}
                {data.outstanding > 0 && (
                  <Link href={`/billing?q=${encodeURIComponent(data.uhid)}`}>
                    <Badge variant="destructive">Earlier bills due {formatINR(data.outstanding)}</Badge>
                  </Link>
                )}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={onChangePatient}>
              Change patient
            </Button>
          </CardContent>
        </Card>

        {data.groups.map((g) => {
          const ids = g.charges.map((c) => c.id);
          const on = ids.filter((id) => !skipped.has(id)).length;
          return (
            <Card key={`${g.account}:${g.admissionId ?? g.visitId ?? 'other'}`}>
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 pb-3">
                <label className="flex items-center gap-3">
                  <GroupCheckbox checked={on === ids.length} mixed={on > 0 && on < ids.length} onChange={(v) => toggle(ids, v)} label={`Bill all of ${g.label}`} />
                  <CardTitle>{g.label}</CardTitle>
                  <Badge variant="outline">{ACCOUNT_LABELS[g.account]}</Badge>
                </label>
                <span className="text-sm font-medium tabular-nums">{formatINR(g.total)}</span>
              </CardHeader>
              <CardContent className="divide-y p-0">
                {g.charges.map((c) => {
                  const on = !skipped.has(c.id);
                  return (
                    <label key={c.id} className={cn('flex cursor-pointer items-center gap-3 px-6 py-2.5 text-sm hover:bg-muted/50', !on && 'text-muted-foreground')}>
                      <input type="checkbox" className="size-4" checked={on} onChange={(e) => toggle([c.id], e.target.checked)} aria-label={`Bill ${c.description}`} />
                      <span className="min-w-0 flex-1">
                        <span className={cn('font-medium', !on && 'line-through')}>{c.description}</span>
                        {c.qty !== 1 && <span className="text-muted-foreground"> × {c.qty}</span>}
                        <span className="block text-xs text-muted-foreground">
                          {sourceLabel(c.sourceModule)} · {formatDate(c.chargeDate)}
                          {c.discount > 0 && ` · discount ${formatINR(c.discount)}`}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">{formatINR(c.amount)}</span>
                    </label>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}

        {!charges.length && <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Nothing pending on this patient&apos;s account. Add an item to bill something now.</p>}

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle>Added at the desk</CardTitle>
            {!adding && (
              <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                <Plus /> Add item
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {adding && (
              <ServiceSearch
                autoFocus
                onPick={(s) => setExtras((xs) => [...xs, { key: nextKey++, service: s, qty: '1', price: '' }])}
              />
            )}
            {extras.length > 0 && (
              <div className="divide-y rounded-md border">
                {extras.map((e) => (
                  <div key={e.key} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{e.service.name}</span> <span className="font-mono text-xs text-muted-foreground">{e.service.code}</span>
                      {!!e.service.packageItems?.length && <span className="block text-xs text-muted-foreground">Package: {e.service.packageItems.map((p) => p.name).join(', ')}</span>}
                    </span>
                    <Input
                      aria-label={`Quantity of ${e.service.name}`}
                      className="w-20"
                      type="number"
                      min={0.01}
                      step="any"
                      value={e.qty}
                      onChange={(ev) => setExtras((xs) => xs.map((x) => (x.key === e.key ? { ...x, qty: ev.target.value } : x)))}
                    />
                    {canOverridePrice ? (
                      <Input
                        aria-label={`Price of ${e.service.name}`}
                        className="w-28"
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder={`${e.service.basePrice}`}
                        value={e.price}
                        onChange={(ev) => setExtras((xs) => xs.map((x) => (x.key === e.key ? { ...x, price: ev.target.value } : x)))}
                      />
                    ) : (
                      <span className="w-28 text-right tabular-nums">{formatINR(e.service.basePrice)}</span>
                    )}
                    <Button variant="ghost" size="icon" aria-label={`Remove ${e.service.name}`} onClick={() => setExtras((xs) => xs.filter((x) => x.key !== e.key))}>
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {!adding && !extras.length && <p className="text-sm text-muted-foreground">Anything not posted by a department: search the service master by name.</p>}
          </CardContent>
        </Card>

        <SuggestedCredits reversals={data.reversals} />
      </div>

      <div className="space-y-6">
        <Card className="lg:sticky lg:top-4">
          <CardHeader className="pb-3">
            <CardTitle>Bill</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {picked.length} of {charges.length} charges{extras.length ? ` + ${extras.length} added` : ''}
                </span>
              </div>
              <Field id="bill-discount" label="Bill discount (₹)" error={discountError}>
                <Input id="bill-discount" type="number" min={0} step="0.01" placeholder="0" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </Field>
              {discountLimit !== null && <p className="text-xs text-muted-foreground">You can give up to {discountLimit}% of the bill.</p>}
              <div className="flex justify-between border-t pt-2 text-base font-semibold">
                <span>Total</span>
                <span className="tabular-nums">
                  {approximate && '≈ '}
                  {formatINR(total)}
                </span>
              </div>
              {advance > 0 && canCollect && (
                <label className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <input type="checkbox" className="size-4" checked={applyAdvance} onChange={(e) => setUseAdvance(e.target.checked)} />
                    Use advance ({formatINR(advance)})
                  </span>
                  {applyAdvance && <span className="tabular-nums">− {formatINR(fromAdvance)}</span>}
                </label>
              )}
              {applyAdvance && (
                <div className="flex justify-between font-semibold text-primary">
                  <span>To collect</span>
                  <span className="tabular-nums">{formatINR(due)}</span>
                </div>
              )}
            </div>

            {canCollect && due > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium">Payment</div>
                <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Payment mode">
                  {B.PAYMENT_MODES.map((m) => (
                    <Button key={m} type="button" role="radio" aria-checked={mode === m} size="sm" variant={mode === m ? 'default' : 'outline'} onClick={() => setMode(m)}>
                      {m === 'bank' ? 'Bank' : MODE_LABELS[m]}
                    </Button>
                  ))}
                </div>
                {mode !== 'cash' && (
                  <Input
                    aria-label="Payment reference"
                    maxLength={100}
                    placeholder={mode === 'upi' ? 'UPI transaction ID' : mode === 'card' ? 'Card last 4 / approval code' : mode === 'cheque' ? 'Cheque number' : 'UTR / reference'}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                )}
              </div>
            )}

            <Field id="bill-notes" label="Note on the bill (optional)">
              <Input id="bill-notes" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>

            <ErrorBox error={formError ?? (bill.error ? errorMessage(bill.error) : null)} />

            {canFinalize ? (
              <div className="space-y-2">
                {canCollect && (
                  <Button className="w-full" size="lg" disabled={bill.isPending || nothing} onClick={() => submit(true)}>
                    {bill.isPending && bill.variables && <Loader2 className="animate-spin" />}
                    {due > 0 ? `Collect ${approximate ? '≈ ' : ''}${formatINR(due)}` : 'Bill from advance'}
                  </Button>
                )}
                {due > 0 && (
                  <Button className="w-full" variant={canCollect ? 'outline' : 'default'} disabled={bill.isPending || nothing} onClick={() => submit(false)}>
                    {bill.isPending && !bill.variables && <Loader2 className="animate-spin" />}
                    Bill only, collect later
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">You need permission to finalize bills to bill from here.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
