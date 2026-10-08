'use client';

import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Search } from 'lucide-react';
import { billing as B } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/validate';
import { Can, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CATEGORY_LABELS, ErrorBox, Field, formatINR, useDebounced } from '@/modules/billing/ui';

interface Form {
  id?: string;
  code: string;
  name: string;
  category: B.ServiceCategory;
  hsnSac: string;
  basePrice: string;
  taxRate: string;
  isActive: boolean;
  packageItems: string[];
}
const blank: Form = { code: '', name: '', category: 'consultation', hsnSac: '', basePrice: '', taxRate: '0', isActive: true, packageItems: [] };

export default function ServicesPage() {
  const canRead = usePermission('billing.service.read');
  const canManage = usePermission('billing.service.manage');
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [form, setForm] = React.useState<Form | null>(null);
  const q = useDebounced(search.trim());

  const query: B.ServiceQuery = { q: q || undefined, category: (category || undefined) as B.ServiceCategory | undefined, active: 'all', pageSize: 200 };
  const { data, isPending, error } = useQuery({
    queryKey: ['billing', 'services', query],
    queryFn: () => api.billing.services.list(query),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });
  const { data: all } = useQuery({
    queryKey: ['billing', 'services', 'all-for-packages'],
    queryFn: () => api.billing.services.list({ active: 'true', pageSize: 200 }),
    enabled: !!form && form.category === 'package',
  });

  const [errors, setErrors] = React.useState<FieldErrors>({});
  const save = useMutation({
    mutationFn: (req: { id?: string; update?: B.UpdateService; create?: B.CreateService }) =>
      req.id ? api.billing.services.update(req.id, req.update!) : api.billing.services.create(req.create!),
    onSuccess: () => {
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ['billing', 'services'] });
    },
  });

  /** Same rules as the server, shown on the fields before anything is sent. */
  const submit = (f: Form) => {
    const body = {
      name: f.name,
      category: f.category,
      hsnSac: f.hsnSac.trim() || undefined,
      basePrice: f.basePrice.trim() === '' ? undefined : f.basePrice,
      taxRate: Number(f.taxRate),
      isActive: f.isActive,
      packageItems: f.category === 'package' ? f.packageItems.map((serviceId) => ({ serviceId, qty: 1 })) : undefined,
    };
    if (f.id) {
      const r = validate(B.updateServiceSchema, body);
      setErrors(r.errors ?? {});
      if (r.data) save.mutate({ id: f.id, update: r.data });
    } else {
      const r = validate(B.createServiceSchema, { ...body, code: f.code });
      setErrors(r.errors ?? {});
      if (r.data) save.mutate({ create: r.data });
    }
  };

  const edit = async (s: B.Service) => {
    setErrors({});
    const full = s.category === 'package' ? await api.billing.services.get(s.id) : s;
    setForm({
      id: s.id,
      code: s.code,
      name: s.name,
      category: s.category,
      hsnSac: s.hsnSac ?? '',
      basePrice: String(s.basePrice),
      taxRate: String(s.taxRate),
      isActive: s.isActive,
      packageItems: full.packageItems?.map((p) => p.serviceId) ?? [],
    });
  };

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Services & prices"
        description="The service master used on bills: consultations, procedures, tests, rooms and packages. Base price applies when no price list covers a service."
        actions={
          <Can permission="billing.service.manage">
            <Button
              onClick={() => {
                setErrors({});
                setForm({ ...blank });
              }}
            >
              <Plus /> Add service
            </Button>
          </Can>
        }
      />

      {form && canManage && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{form.id ? `Edit ${form.code}` : 'New service'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault();
                submit(form);
              }}
            >
              <div className="sm:col-span-3">
                <ErrorBox error={save.error ? errorMessage(save.error) : null} />
              </div>
              <Field id="code" label="Code *" error={errors.code}>
                <Input id="code" maxLength={40} value={form.code} disabled={!!form.id} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. CONS-GEN" required />
              </Field>
              <Field id="name" label="Name *" className="sm:col-span-2" error={errors.name}>
                <Input id="name" maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </Field>
              <Field id="category" label="Category">
                <Select id="category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as B.ServiceCategory })}>
                  {B.SERVICE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="price" label="Base price (₹) *" error={errors.basePrice}>
                <Input id="price" type="number" min={0} step="0.01" value={form.basePrice} onChange={(e) => setForm({ ...form, basePrice: e.target.value })} required />
              </Field>
              <Field id="tax" label="GST %">
                <Select id="tax" value={form.taxRate} onChange={(e) => setForm({ ...form, taxRate: e.target.value })}>
                  {B.GST_RATES.map((g) => (
                    <option key={g} value={String(g)}>
                      {g}%{g === 0 ? ' (exempt healthcare)' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="hsn" label="HSN / SAC" error={errors.hsnSac}>
                <Input id="hsn" inputMode="numeric" maxLength={8} value={form.hsnSac} onChange={(e) => setForm({ ...form, hsnSac: e.target.value })} placeholder="e.g. 999312" />
              </Field>
              <label className="flex items-center gap-2 pt-7 text-sm">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active
              </label>
              {form.category === 'package' && (
                <Field label="Included services" className="sm:col-span-3">
                  <div className="grid max-h-56 gap-1 overflow-auto rounded-md border p-2 sm:grid-cols-2">
                    {all?.items
                      .filter((s) => s.category !== 'package')
                      .map((s) => (
                        <label key={s.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={form.packageItems.includes(s.id)}
                            onChange={(e) =>
                              setForm({ ...form, packageItems: e.target.checked ? [...form.packageItems, s.id] : form.packageItems.filter((x) => x !== s.id) })
                            }
                          />
                          {s.name} <span className="text-xs text-muted-foreground">{s.code}</span>
                        </label>
                      ))}
                  </div>
                </Field>
              )}
              <div className="flex justify-end gap-2 sm:col-span-3">
                <Button type="button" variant="outline" onClick={() => setForm(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending && <Loader2 className="animate-spin" />}
                  Save
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" placeholder="Search code or name…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select className="w-44" value={category} aria-label="Category" onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {B.SERVICE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </div>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>HSN/SAC</TableHead>
                <TableHead className="text-right">Base price</TableHead>
                <TableHead className="text-right">GST</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No services yet. Add consultations, procedures and tests here.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.code}</TableCell>
                    <TableCell className="font-medium">
                      {s.name} {!s.isActive && <Badge variant="secondary">Inactive</Badge>}
                    </TableCell>
                    <TableCell>{CATEGORY_LABELS[s.category]}</TableCell>
                    <TableCell>{s.hsnSac ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(s.basePrice)}</TableCell>
                    <TableCell className="text-right">{s.taxRate}%</TableCell>
                    <TableCell className="text-right">
                      {canManage && (
                        <Button variant="ghost" size="sm" onClick={() => void edit(s)}>
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
