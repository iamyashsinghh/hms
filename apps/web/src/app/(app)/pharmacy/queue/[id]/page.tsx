'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { pharmacy } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { inr } from '@/modules/pharmacy/format';
import { ItemPicker } from '@/modules/pharmacy/item-picker';
import { StockHint, useFefoEstimate } from '@/modules/pharmacy/stock-hint';
import { StorePicker, useActiveStore } from '@/modules/pharmacy/use-store';

interface Give {
  itemId?: string;
  itemName?: string;
  qty: number;
}

function DispenseRow({
  line,
  give,
  storeId,
  editable,
  onChange,
  onAmount,
}: {
  line: pharmacy.PrescriptionLine;
  give: Give;
  storeId?: string;
  editable: boolean;
  onChange: (g: Give) => void;
  onAmount: (id: string, amount: number, short: boolean) => void;
}) {
  const est = useFefoEstimate(storeId, give.itemId, give.qty);
  const remaining = line.qty > 0 ? line.qty - line.dispensedQty : undefined;
  React.useEffect(() => onAmount(line.id, give.itemId && give.qty > 0 ? est.amount : 0, !!give.itemId && give.qty > 0 && est.short), [line.id, give.itemId, give.qty, est.amount, est.short, onAmount]);
  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{line.drugName}</div>
        <div className="text-xs text-muted-foreground">{[line.dose, line.frequency, line.days ? `${line.days} days` : null].filter(Boolean).join(' · ')}</div>
      </TableCell>
      <TableCell className="tabular-nums">
        {line.qty || '—'}
        {line.dispensedQty > 0 && <span className="text-xs text-muted-foreground"> (given {line.dispensedQty})</span>}
      </TableCell>
      <TableCell className="min-w-64">
        {editable ? (
          give.itemId ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">{give.itemName}</span>
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => onChange({ ...give, itemId: undefined, itemName: undefined })}>
                  change
                </button>
              </div>
              <StockHint est={est} />
            </div>
          ) : (
            <ItemPicker placeholder="Pick item to give…" onPick={(it) => onChange({ ...give, itemId: it.id, itemName: it.name })} />
          )
        ) : (
          (line.itemName ?? '—')
        )}
      </TableCell>
      <TableCell>
        {editable ? (
          <Input className="w-20" type="number" min={0} max={remaining} value={give.qty} onChange={(e) => onChange({ ...give, qty: Math.max(0, Math.min(remaining ?? Infinity, Number(e.target.value) || 0)) })} />
        ) : null}
      </TableCell>
      <TableCell className="text-right tabular-nums">{editable && give.itemId && give.qty > 0 ? inr(est.amount) : ''}</TableCell>
    </TableRow>
  );
}

export default function DispensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('pharmacy.prescription.read');
  const canDispense = usePermission('pharmacy.prescription.dispense');
  const router = useRouter();
  const queryClient = useQueryClient();
  const active = useActiveStore();
  const storeId = active.store?.id;
  const { data: rx, isPending, error } = useQuery({ queryKey: ['pharmacy', 'prescriptions', id], queryFn: () => api.pharmacy.prescriptions.get(id), enabled: canRead });
  const [edits, setEdits] = React.useState<Record<string, Give>>({});
  const [paymentMode, setPaymentMode] = React.useState<(typeof pharmacy.PAYMENT_MODES)[number]>('cash');
  const [amounts, setAmounts] = React.useState<Record<string, { amount: number; short: boolean }>>({});
  const onAmount = React.useCallback((lineId: string, amount: number, short: boolean) => setAmounts((a) => ({ ...a, [lineId]: { amount, short } })), []);

  // What to give per line: the user's edits over defaults (matched item, remaining quantity).
  const give: Record<string, Give> = Object.fromEntries(
    (rx?.lines ?? []).map((l) => [
      l.id,
      edits[l.id] ?? { itemId: l.itemId ?? undefined, itemName: l.itemName ?? undefined, qty: l.qty > 0 ? l.qty - l.dispensedQty : 0 },
    ]),
  );

  const dispense = useMutation({
    mutationFn: () =>
      api.pharmacy.prescriptions.dispense(id, {
        storeId: storeId!,
        paymentMode,
        lines: Object.entries(give)
          .filter(([, g]) => g.itemId && g.qty > 0)
          .map(([prescriptionLineId, g]) => ({ prescriptionLineId, itemId: g.itemId, qty: g.qty })),
      }),
    onSuccess: (sale) => {
      queryClient.invalidateQueries({ queryKey: ['pharmacy'] });
      router.push(`/pharmacy/sales/${sale.id}`);
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.pharmacy.prescriptions.cancel(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pharmacy', 'prescriptions'] }),
  });

  if (!canRead) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;

  const open = rx.status === 'pending' || rx.status === 'partial';
  const editable = open && canDispense;
  const chosen = Object.entries(give).filter(([, g]) => g.itemId && g.qty > 0);
  const total = chosen.reduce((s, [lineId]) => s + (amounts[lineId]?.amount ?? 0), 0);
  const short = chosen.some(([lineId]) => amounts[lineId]?.short);

  return (
    <div className="space-y-6">
      <Link href="/pharmacy/queue" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
        <ArrowLeft /> Prescription queue
      </Link>
      <PageHeader
        title={rx.patientName}
        description={
          <>
            <span className="font-mono">{rx.uhid}</span> · {rx.source === 'emr' ? 'OPD prescription' : 'Paper prescription'}
            {rx.doctorName && ` · ${rx.doctorName}`} · {formatDate(rx.createdAt)}{' '}
            <Badge variant={open ? 'default' : 'secondary'}>{rx.status}</Badge>
          </>
        }
        actions={editable ? <StorePicker active={active} /> : undefined}
      />
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Prescribed</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Give</TableHead>
              <TableHead>{editable ? 'Now' : ''}</TableHead>
              <TableHead className="text-right">{editable ? 'Amount' : ''}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rx.lines.map((l) => (
              <DispenseRow
                key={l.id}
                line={l}
                storeId={storeId}
                editable={editable && (l.qty === 0 || l.dispensedQty < l.qty)}
                give={give[l.id]!}
                onAmount={onAmount}
                onChange={(g) => setEdits((all) => ({ ...all, [l.id]: g }))}
              />
            ))}
          </TableBody>
        </Table>
      </Card>
      {editable && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-end gap-4 pt-6">
            {rx.status === 'pending' && (
              <Button variant="ghost" className="mr-auto" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                Cancel prescription
              </Button>
            )}
            <Select aria-label="Payment" className="w-32" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as typeof paymentMode)}>
              {pharmacy.PAYMENT_MODES.map((m) => (
                <option key={m} value={m}>
                  {m.toUpperCase()}
                </option>
              ))}
            </Select>
            <span className="text-lg font-semibold tabular-nums">{inr(total)}</span>
            <Button size="lg" disabled={!storeId || !chosen.length || short || dispense.isPending} onClick={() => dispense.mutate()}>
              {dispense.isPending && <Loader2 className="animate-spin" />} Dispense &amp; bill
            </Button>
            {short && <p className="w-full text-right text-sm text-destructive">Not enough stock for one or more lines; lower the quantity or give partly.</p>}
            <p className="w-full text-right text-xs text-muted-foreground">For an admitted patient the medicines go on the IPD bill (per the hospital&apos;s billing rules); nothing is collected here.</p>
            {(dispense.error || cancel.error) && <p className="w-full text-right text-sm text-destructive">{errorMessage(dispense.error ?? cancel.error)}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
