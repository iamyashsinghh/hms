'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import { billing as B, type Patient } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
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
}

let nextKey = 1;
const emptyRow = (): Row => ({ key: nextKey++, code: '', description: '', qty: '1', price: '', discount: '', taxRate: '' });

export default function Page() {
  return (
    <React.Suspense>
      <NewBillPage />
    </React.Suspense>
  );
}

function NewBillPage() {
  const canCreate = usePermission('billing.invoice.create');
  const canFinalize = usePermission('billing.invoice.finalize');
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [patient, setPatient] = React.useState<Patient | null>(null);
  const [rows, setRows] = React.useState<Row[]>(() => [emptyRow()]);
  const [notes, setNotes] = React.useState('');
  const [supplyType, setSupplyType] = React.useState<'intra' | 'inter'>('intra');
  const [formError, setFormError] = React.useState<string | null>(null);

  const presetPatient = params.get('patientId');
  React.useEffect(() => {
    if (presetPatient) api.patients.get(presetPatient).then(setPatient).catch(() => undefined);
  }, [presetPatient]);

  const { data: services } = useQuery({
    queryKey: ['billing', 'services', 'active'],
    queryFn: () => api.billing.services.list({ active: 'true', pageSize: 200 }),
    enabled: canCreate,
  });
  const byCode = React.useMemo(() => new Map((services?.items ?? []).map((s) => [s.code, s])), [services]);

  const create = useMutation({
    mutationFn: (finalize: boolean) => {
      const lines: B.InvoiceLineInput[] = rows
        .filter((r) => r.code || r.description)
        .map((r) => {
          const svc = byCode.get(r.code.trim().toUpperCase());
          return {
            serviceCode: svc?.code,
            description: r.description.trim() || undefined,
            qty: Number(r.qty) || 1,
            unitPrice: r.price === '' ? undefined : Number(r.price),
            discount: r.discount === '' ? undefined : Number(r.discount),
            taxRate: r.taxRate === '' ? undefined : Number(r.taxRate),
          };
        });
      return api.billing.invoices.create({ patientId: patient!.id, lines, notes: notes.trim() || undefined, supplyType, finalize });
    },
    onSuccess: (inv) => {
      queryClient.invalidateQueries({ queryKey: ['billing'] });
      router.push(`/billing/invoices/${inv.id}`);
    },
  });

  if (!canCreate) return <NoAccess />;

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
    if (!patient) return setFormError('Choose a patient first.');
    const bad = rows.find((r) => (r.code || r.description) && !byCode.get(r.code.trim().toUpperCase()) && (!r.description || r.price === ''));
    if (bad) return setFormError('Each line needs a service from the list, or a description and a price.');
    if (!rows.some((r) => r.code || r.description)) return setFormError('Add at least one line.');
    create.mutate(finalize);
  };

  return (
    <div className="max-w-5xl">
      <Link href="/billing" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> All bills
      </Link>
      <PageHeader title="New bill" description="Pick services from the master; leave the price blank to use the price list. The bill number is given when it is finalized." />

      <div className="space-y-6">
        <ErrorBox error={formError ?? (create.error ? errorMessage(create.error) : null)} />

        <Card>
          <CardContent className="grid gap-5 pt-6 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <PatientPicker value={patient} onChange={setPatient} />
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
                    onChange={(e) => update(r.key, { description: e.target.value })}
                  />
                  <Input className="sm:col-span-1" type="number" min={0} step="any" aria-label="Quantity" value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} />
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
          <Button type="button" variant="outline" disabled={create.isPending} onClick={() => submit(false)}>
            Save draft
          </Button>
          {canFinalize && (
            <Button type="button" disabled={create.isPending} onClick={() => submit(true)}>
              {create.isPending && <Loader2 className="animate-spin" />}
              Finalize bill
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
