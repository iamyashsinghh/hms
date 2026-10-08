'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { billing as B, type Patient } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { firstError, validate } from '@/lib/validate';
import { usePermission } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { ErrorBox, Field, PatientPicker, formatINR } from '@/modules/billing/ui';

interface Row {
  key: number;
  code: string;
  description: string;
  qty: string;
  price: string;
  discount: string;
  taxRate: string;
  /** Kept from an existing line (e.g. a pharmacy item) so editing a draft does not lose it. */
  itemId?: string;
  hsnSac?: string;
}

let nextKey = 1;
const emptyRow = (): Row => ({ key: nextKey++, code: '', description: '', qty: '1', price: '', discount: '', taxRate: '' });
const rowOf = (l: B.InvoiceLine): Row => ({
  key: nextKey++,
  code: l.serviceCode ?? '',
  description: l.description,
  qty: String(l.qty),
  price: String(l.unitPrice),
  discount: l.discount ? String(l.discount) : '',
  taxRate: String(l.taxRate),
  itemId: l.itemId ?? undefined,
  hsnSac: l.hsnSac ?? undefined,
});

const isNum = (v: string) => v.trim() !== '' && Number.isFinite(Number(v));

/**
 * New bill, or edit of a draft bill (`invoice` given). Finalized bills are immutable on the server
 * (credit notes instead), so the edit screen is only reachable while the bill is a draft.
 */
export function BillForm({ invoice, presetPatient }: { invoice?: B.Invoice; presetPatient?: Patient | null }) {
  const editing = !!invoice;
  const canFinalize = usePermission('billing.invoice.finalize');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [patient, setPatient] = React.useState<Patient | null>(presetPatient ?? null);
  const [rows, setRows] = React.useState<Row[]>(() => (invoice?.lines.length ? invoice.lines.map(rowOf) : [emptyRow()]));
  const [notes, setNotes] = React.useState(invoice?.notes ?? '');
  const [supplyType, setSupplyType] = React.useState<'intra' | 'inter'>(invoice?.supplyType ?? 'intra');
  const [formError, setFormError] = React.useState<string | null>(null);

  const { data: services } = useQuery({
    queryKey: ['billing', 'services', 'active'],
    queryFn: () => api.billing.services.list({ active: 'true', pageSize: 200 }),
  });
  const byCode = React.useMemo(() => new Map((services?.items ?? []).map((s) => [s.code, s])), [services]);

  const toLines = (): B.InvoiceLineInput[] =>
    rows
      .filter((r) => r.code || r.description)
      .map((r) => {
        const svc = byCode.get(r.code.trim().toUpperCase());
        return {
          serviceCode: svc?.code,
          itemId: svc ? undefined : r.itemId,
          hsnSac: svc ? undefined : r.hsnSac,
          description: r.description.trim() || undefined,
          qty: Number(r.qty),
          unitPrice: r.price === '' ? undefined : Number(r.price),
          discount: r.discount === '' ? undefined : Number(r.discount),
          taxRate: r.taxRate === '' ? undefined : Number(r.taxRate),
        };
      });

  const save = useMutation({
    mutationFn: async (finalize: boolean) => {
      const lines = toLines();
      const body = { lines, notes: notes.trim(), supplyType };
      if (!invoice) return api.billing.invoices.create({ patientId: patient!.id, ...body, notes: body.notes || undefined, finalize });
      const updated = await api.billing.invoices.update(invoice.id, body);
      return finalize ? api.billing.invoices.finalize(invoice.id) : updated;
    },
    onSuccess: (inv) => {
      queryClient.invalidateQueries({ queryKey: ['billing'] });
      router.push(`/billing/invoices/${inv.id}`);
    },
  });

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const estimate = rows.reduce((sum, r) => {
    const svc = byCode.get(r.code.trim().toUpperCase());
    const price = r.price !== '' ? Number(r.price) : (svc?.basePrice ?? 0);
    const rate = r.taxRate !== '' ? Number(r.taxRate) : (svc?.taxRate ?? 0);
    const taxable = Math.max(0, (Number(r.qty) || 0) * price - (Number(r.discount) || 0));
    return sum + taxable * (1 + rate / 100);
  }, 0);

  const submit = (finalize: boolean) => {
    setFormError(null);
    if (!patient && !editing) return setFormError('Choose a patient first.');
    const used = rows.filter((r) => r.code || r.description);
    if (!used.length) return setFormError('Add at least one line.');
    const bad = used.find((r) => !byCode.get(r.code.trim().toUpperCase()) && (!r.description.trim() || r.price === ''));
    if (bad) return setFormError('Each line needs a service from the list, or a description and a price.');
    if (used.some((r) => !isNum(r.qty) || Number(r.qty) <= 0)) return setFormError('Quantity must be more than 0.');
    if (used.some((r) => (r.price !== '' && (!isNum(r.price) || Number(r.price) < 0)) || (r.discount !== '' && (!isNum(r.discount) || Number(r.discount) < 0))))
      return setFormError('Price and discount must be zero or more.');
    const lines = toLines();
    for (const [i, line] of lines.entries()) {
      const r = validate(B.invoiceLineInputSchema, line);
      if (r.errors) return setFormError(`Line ${i + 1}: ${firstError(r.errors)}`);
      // Price from the master when left blank: the discount still cannot be more than the line.
      const svc = line.serviceCode ? byCode.get(line.serviceCode) : undefined;
      const price = line.unitPrice ?? svc?.basePrice;
      if (price !== undefined && Number(line.discount ?? 0) > Number(line.qty) * Number(price)) return setFormError(`Line ${i + 1}: Discount is more than the line amount`);
    }
    const parsed = B.updateInvoiceSchema.safeParse({ lines, notes: notes.trim(), supplyType });
    if (!parsed.success) return setFormError(parsed.error.issues[0]?.message ?? 'Check the bill lines.');
    save.mutate(finalize);
  };

  return (
    <div className="space-y-6">
      <ErrorBox error={formError ?? (save.error ? errorMessage(save.error) : null)} />

      <Card>
        <CardContent className="grid gap-5 pt-6 sm:grid-cols-3">
          <div className="sm:col-span-2">
            {editing ? (
              <Field id="patient" label="Patient">
                <p id="patient" className="py-2 text-sm">
                  {invoice.patientName} · <span className="font-mono">{invoice.patientUhid}</span>
                </p>
              </Field>
            ) : (
              <PatientPicker value={patient} onChange={setPatient} />
            )}
          </div>
          <Field id="supply" label="GST supply">
            <Select id="supply" value={supplyType} onChange={(e) => setSupplyType(e.target.value as 'intra' | 'inter')}>
              <option value="intra">Within state (CGST + SGST)</option>
              <option value="inter">Other state (IGST)</option>
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Items</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
            <Plus /> Add line
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <datalist id="billing-services">
            {services?.items.map((s) => (
              <option key={s.id} value={s.code}>
                {s.name} · {formatINR(s.basePrice)}
              </option>
            ))}
          </datalist>
          <div className="hidden grid-cols-12 gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:grid">
            <span className="col-span-2">Service code</span>
            <span className="col-span-4">Description</span>
            <span className="col-span-1">Qty</span>
            <span className="col-span-2">Price (₹)</span>
            <span className="col-span-1">Disc. ₹</span>
            <span className="col-span-1">GST %</span>
          </div>
          {rows.map((r) => {
            const svc = byCode.get(r.code.trim().toUpperCase());
            return (
              <div key={r.key} className="grid grid-cols-2 gap-2 sm:grid-cols-12">
                <Input className="sm:col-span-2" list="billing-services" placeholder="Code" aria-label="Service code" value={r.code} onChange={(e) => update(r.key, { code: e.target.value })} />
                <Input
                  className="sm:col-span-4"
                  placeholder={svc?.name ?? 'Description (for items not in the master)'}
                  aria-label="Description"
                  value={r.description}
                  maxLength={300}
                  onChange={(e) => update(r.key, { description: e.target.value })}
                />
                <Input className="sm:col-span-1" type="number" min={0.01} max={100000} step="any" aria-label="Quantity" value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} />
                <Input
                  className="sm:col-span-2"
                  type="number"
                  min={0}
                  step="0.01"
                  aria-label="Unit price"
                  placeholder={svc ? `auto (${svc.basePrice})` : '0.00'}
                  value={r.price}
                  onChange={(e) => update(r.key, { price: e.target.value })}
                />
                <Input className="sm:col-span-1" type="number" min={0} step="0.01" aria-label="Discount" value={r.discount} onChange={(e) => update(r.key, { discount: e.target.value })} />
                <Select className="sm:col-span-1" aria-label="GST rate" value={r.taxRate} onChange={(e) => update(r.key, { taxRate: e.target.value })}>
                  <option value="">{svc ? `${svc.taxRate}` : '0'}</option>
                  {B.GST_RATES.map((g) => (
                    <option key={g} value={String(g)}>
                      {g}
                    </option>
                  ))}
                </Select>
                <Button type="button" variant="ghost" size="icon" aria-label="Remove line" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [emptyRow()]))}>
                  <Trash2 />
                </Button>
              </div>
            );
          })}
          <p className="pt-2 text-right text-sm text-muted-foreground">
            Estimated total <span className="font-semibold text-foreground">{formatINR(estimate)}</span> (exact amount after saving)
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Field id="notes" label="Notes on the bill">
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        {editing && (
          <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => router.push(`/billing/invoices/${invoice.id}`)}>
            Cancel
          </Button>
        )}
        <Button type="button" variant="outline" disabled={save.isPending} onClick={() => submit(false)}>
          {editing ? 'Save changes' : 'Save draft'}
        </Button>
        {canFinalize && (
          <Button type="button" disabled={save.isPending} onClick={() => submit(true)}>
            {save.isPending && <Loader2 className="animate-spin" />}
            {editing ? 'Save and finalize' : 'Finalize bill'}
          </Button>
        )}
      </div>
    </div>
  );
}
