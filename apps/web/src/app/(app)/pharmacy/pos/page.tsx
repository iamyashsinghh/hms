'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2 } from 'lucide-react';
import { pharmacy, type Patient } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/validate';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SCHEDULE_LABEL, inr } from '@/modules/pharmacy/format';
import { ItemPicker } from '@/modules/pharmacy/item-picker';
import { PatientPicker } from '@/modules/pharmacy/patient-picker';
import { StockHint, useFefoEstimate } from '@/modules/pharmacy/stock-hint';
import { StorePicker, useActiveStore } from '@/modules/pharmacy/use-store';

interface Line {
  key: number;
  item: pharmacy.Item;
  qty: number;
  discountPct: number;
}
let nextKey = 1;

function LineRow({ storeId, line, onChange, onRemove, onAmount }: { storeId?: string; line: Line; onChange: (l: Partial<Line>) => void; onRemove: () => void; onAmount: (key: number, amount: number, short: boolean) => void }) {
  const est = useFefoEstimate(storeId, line.item.id, line.qty, line.discountPct);
  React.useEffect(() => onAmount(line.key, est.amount, est.short), [line.key, est.amount, est.short, onAmount]);
  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">
          {line.item.name}{' '}
          {line.item.schedule !== 'otc' && <Badge variant="accent">{SCHEDULE_LABEL[line.item.schedule]}</Badge>}
        </div>
        <StockHint est={est} />
      </TableCell>
      <TableCell>
        <Input className="w-20" type="number" min={1} value={line.qty} onChange={(e) => onChange({ qty: Math.max(1, Number(e.target.value) || 1) })} />
      </TableCell>
      <TableCell>
        <Input className="w-20" type="number" min={0} max={100} value={line.discountPct} onChange={(e) => onChange({ discountPct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} />
      </TableCell>
      <TableCell className="text-right tabular-nums">{inr(est.amount)}</TableCell>
      <TableCell>
        <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={onRemove}>
          <Trash2 />
        </Button>
      </TableCell>
    </TableRow>
  );
}

export default function NewSalePage() {
  const canSell = usePermission('pharmacy.sale.create');
  const router = useRouter();
  const queryClient = useQueryClient();
  const active = useActiveStore();
  const storeId = active.store?.id;
  const [lines, setLines] = React.useState<Line[]>([]);
  const [patient, setPatient] = React.useState<Patient | null>(null);
  const [customer, setCustomer] = React.useState({ name: '', mobile: '' });
  const [paymentMode, setPaymentMode] = React.useState<(typeof pharmacy.PAYMENT_MODES)[number]>('cash');
  const [rxSeen, setRxSeen] = React.useState(false);
  const [amounts, setAmounts] = React.useState<Record<number, { amount: number; short: boolean }>>({});
  const onAmount = React.useCallback((key: number, amount: number, short: boolean) => setAmounts((a) => ({ ...a, [key]: { amount, short } })), []);

  const [errors, setErrors] = React.useState<FieldErrors>({});
  const sell = useMutation({
    mutationFn: (body: pharmacy.CreateSale) => api.pharmacy.sales.create(body),
    onSuccess: (sale) => {
      queryClient.invalidateQueries({ queryKey: ['pharmacy'] });
      router.push(`/pharmacy/sales/${sale.id}`);
    },
  });

  if (!canSell) return <NoAccess />;
  const needsRx = lines.some((l) => pharmacy.RX_ONLY_SCHEDULES.includes(l.item.schedule));
  const blocked = lines.find((l) => l.item.schedule === 'X' || l.item.schedule === 'narcotic');
  const live = lines.map((l) => amounts[l.key]);
  const total = live.reduce((s, a) => s + (a?.amount ?? 0), 0);
  const short = live.some((a) => a?.short);
  /** Items saved before GST slabs were enforced cannot be billed to a registered patient. */
  const nonSlab = patient ? lines.find((l) => !pharmacy.isGstSlab(l.item.gstRate)) : undefined;
  const complete = () => {
    const r = validate(pharmacy.createSaleSchema, {
      storeId,
      patientId: patient?.id,
      customerName: patient ? undefined : customer.name || undefined,
      customerMobile: patient ? undefined : customer.mobile || undefined,
      paymentMode,
      prescriptionSeen: rxSeen,
      lines: lines.map((l) => ({ itemId: l.item.id, qty: l.qty, discountPct: l.discountPct })),
    });
    setErrors(r.errors ?? {});
    if (r.data) sell.mutate(r.data);
  };

  return (
    <>
      <PageHeader title="New sale" description="Over-the-counter sale. Batches are picked first-expiry-first-out." actions={<StorePicker active={active} />} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="space-y-4 pt-6">
            <ItemPicker autoFocus onPick={(item) => setLines((ls) => (ls.some((l) => l.item.id === item.id) ? ls : [...ls, { key: nextKey++, item, qty: 1, discountPct: 0 }]))} />
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Drug</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Disc %</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      Search and add drugs above.
                    </TableCell>
                  </TableRow>
                ) : (
                  lines.map((l) => (
                    <LineRow
                      key={l.key}
                      storeId={storeId}
                      line={l}
                      onAmount={onAmount}
                      onChange={(p) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, ...p } : x)))}
                      onRemove={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Customer &amp; payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Registered patient (optional)</Label>
              <div className="mt-2">
                <PatientPicker value={patient} onChange={setPatient} />
              </div>
            </div>
            {!patient && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="cname">Name</Label>
                  <Input id="cname" className="mt-2" maxLength={120} value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="cmobile">Mobile</Label>
                  <Input
                    id="cmobile"
                    className="mt-2"
                    inputMode="tel"
                    maxLength={14}
                    aria-invalid={!!errors.customerMobile}
                    value={customer.mobile}
                    onChange={(e) => setCustomer({ ...customer, mobile: e.target.value })}
                  />
                  {errors.customerMobile && <p className="mt-1 text-xs text-destructive">{errors.customerMobile}</p>}
                </div>
              </div>
            )}
            <div>
              <Label htmlFor="mode">Payment</Label>
              <Select id="mode" className="mt-2" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as typeof paymentMode)}>
                {pharmacy.PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m === 'upi' ? 'UPI' : m.charAt(0).toUpperCase() + m.slice(1)}
                  </option>
                ))}
              </Select>
              {errors.paymentMode && <p className="mt-1 text-xs text-destructive">{errors.paymentMode}</p>}
              {patient && (
                <p className="mt-1 text-xs text-muted-foreground">If this patient is admitted, the medicines go on their IPD bill (per the hospital&apos;s billing rules) and nothing is collected here.</p>
              )}
            </div>
            {needsRx && (
              <label className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 p-3 text-sm">
                <input type="checkbox" className="mt-0.5" checked={rxSeen} onChange={(e) => setRxSeen(e.target.checked)} />
                I have seen a valid prescription for the Schedule H / H1 drugs.
              </label>
            )}
            {blocked && <p className="text-sm text-destructive">{blocked.item.name} can only be dispensed from the Rx queue.</p>}
            <div className="flex items-baseline justify-between border-t pt-4">
              <span className="text-sm text-muted-foreground">Total (incl. GST)</span>
              <span className="text-2xl font-semibold tabular-nums">{inr(total)}</span>
            </div>
            {nonSlab && (
              <p className="text-sm text-destructive">
                {nonSlab.item.name} has GST {nonSlab.item.gstRate}%, which is not a GST slab. Edit the drug and pick a slab before selling it to a
                patient.
              </p>
            )}
            {short && <p className="text-sm text-destructive">Not enough stock for one or more lines.</p>}
            {sell.error && <p className="text-sm text-destructive">{errorMessage(sell.error)}</p>}
            <Button className="w-full" size="lg" disabled={!storeId || !lines.length || short || !!blocked || !!nonSlab || (needsRx && !rxSeen) || sell.isPending} onClick={complete}>
              {sell.isPending && <Loader2 className="animate-spin" />} Complete sale
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
