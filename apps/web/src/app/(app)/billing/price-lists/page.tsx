'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { billing as B } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/validate';
import { Can, usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorBox, Field, formatINR, todayIST } from '@/modules/billing/ui';

interface Form {
  id?: string;
  /** Payer whose tariff this is; kept as-is on edit so a payer list never turns into a cash list (BIL-46). */
  payerId: string | null;
  name: string;
  effectiveFrom: string;
  effectiveTo: string;
  isActive: boolean;
  prices: Record<string, string>;
}

export default function PriceListsPage() {
  const canRead = usePermission('billing.service.read');
  const canManage = usePermission('billing.service.manage');
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<Form | null>(null);
  const [errors, setErrors] = React.useState<FieldErrors>({});

  const { data: lists, isPending, error } = useQuery({ queryKey: ['billing', 'price-lists'], queryFn: () => api.billing.priceLists.list(), enabled: canRead });
  const { data: services } = useQuery({
    queryKey: ['billing', 'services', 'active'],
    queryFn: () => api.billing.services.list({ active: 'true', pageSize: 200 }),
    enabled: !!form,
  });

  const [formError, setFormError] = React.useState<string | null>(null);
  const save = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: B.PriceListInput }) => (id ? api.billing.priceLists.update(id, body) : api.billing.priceLists.create(body)),
    onSuccess: () => {
      setForm(null);
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ['billing', 'price-lists'] });
    },
  });

  const submit = (f: Form) => {
    setFormError(null);
    const r = validate(B.priceListInputSchema, {
      name: f.name,
      payerId: f.payerId,
      effectiveFrom: f.effectiveFrom,
      effectiveTo: f.effectiveTo || null,
      isActive: f.isActive,
      items: Object.entries(f.prices)
        .filter(([, v]) => v.trim() !== '')
        .map(([serviceId, price]) => ({ serviceId, price })),
    });
    // Price errors come back as items.<n>.price; show them on the service row.
    const shown: FieldErrors = { ...(r.errors ?? {}) };
    if (r.errors) {
      const filled = Object.entries(f.prices).filter(([, v]) => v.trim() !== '');
      for (const [k, m] of Object.entries(r.errors)) {
        const n = /^items\.(\d+)\./.exec(k)?.[1];
        if (n !== undefined && filled[Number(n)]) shown[`price.${filled[Number(n)]![0]}`] = m;
      }
    }
    setErrors(shown);
    if (r.data) save.mutate({ id: f.id, body: r.data });
  };

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Price lists"
        description="Dated price lists override base prices. The newest active list covering the bill date wins; payer-specific lists (insurance, corporate) come with the insurance module."
        actions={
          <Can permission="billing.service.manage">
            <Button onClick={() => { setErrors({}); setFormError(null); setForm({ payerId: null, name: '', effectiveFrom: todayIST(), effectiveTo: '', isActive: true, prices: {} }); }}>
              <Plus /> New price list
            </Button>
          </Can>
        }
      />

      {form && canManage && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{form.id ? `Edit ${form.name}` : 'New price list'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ErrorBox error={formError ?? (save.error ? errorMessage(save.error) : null)} />
            <div className="grid gap-4 sm:grid-cols-4">
              <Field id="pl-name" label="Name *" className="sm:col-span-2">
                <Input id="pl-name" maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Cash rates 2026-27" />
                {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name}</p>}
              </Field>
              <Field id="pl-from" label="Effective from *">
                <Input id="pl-from" type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
                {errors.effectiveFrom && <p className="mt-1 text-xs text-destructive">{errors.effectiveFrom}</p>}
              </Field>
              <Field id="pl-to" label="Effective to">
                <Input id="pl-to" type="date" min={form.effectiveFrom || undefined} value={form.effectiveTo} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })} />
                {errors.effectiveTo && <p className="mt-1 text-xs text-destructive">{errors.effectiveTo}</p>}
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active
            </label>
            <div className="max-h-96 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Service</TableHead>
                    <TableHead className="text-right">Base price</TableHead>
                    <TableHead className="w-40">List price (₹)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {services?.items.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        {s.name} <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(s.basePrice)}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          aria-label={`Price for ${s.name}`}
                          placeholder="base"
                          value={form.prices[s.id] ?? ''}
                          onChange={(e) => setForm({ ...form, prices: { ...form.prices, [s.id]: e.target.value } })}
                        />
                        {errors[`price.${s.id}`] && <p className="mt-1 text-xs text-destructive">{errors[`price.${s.id}`]}</p>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setForm(null);
                  setFormError(null);
                }}
              >
                Cancel
              </Button>
              <Button disabled={save.isPending || !form.name.trim()} onClick={() => submit(form)}>
                {save.isPending && <Loader2 className="animate-spin" />}
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Valid</TableHead>
                <TableHead className="text-right">Services</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : lists.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    No price lists. Bills use each service&apos;s base price.
                  </TableCell>
                </TableRow>
              ) : (
                lists.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">
                      {l.name} {l.payerId && <Badge variant="outline">Payer tariff</Badge>} {!l.isActive && <Badge variant="secondary">Inactive</Badge>}
                    </TableCell>
                    <TableCell>
                      {formatDate(l.effectiveFrom)} – {l.effectiveTo ? formatDate(l.effectiveTo) : 'open'}
                    </TableCell>
                    <TableCell className="text-right">{l.items.length}</TableCell>
                    <TableCell className="text-right">
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setErrors({});
                            setForm({
                              id: l.id,
                              payerId: l.payerId,
                              name: l.name,
                              effectiveFrom: l.effectiveFrom,
                              effectiveTo: l.effectiveTo ?? '',
                              isActive: l.isActive,
                              prices: Object.fromEntries(l.items.map((i) => [i.serviceId, String(i.price)])),
                            });
                          }}
                        >
                          Edit
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
