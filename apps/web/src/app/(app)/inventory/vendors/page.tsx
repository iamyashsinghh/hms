'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { inventory } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/validate';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const EMPTY = { code: '', name: '', contactPerson: '', phone: '', email: '', gstin: '', pan: '', address: '', paymentTermsDays: '30' };
type Form = typeof EMPTY;

export default function VendorsPage() {
  const canRead = usePermission('inventory.vendor.read');
  const canManage = usePermission('inventory.vendor.manage');
  const queryClient = useQueryClient();
  const [q, setQ] = React.useState('');
  const [showInactive, setShowInactive] = React.useState(false);
  const [editing, setEditing] = React.useState<inventory.Vendor | 'new' | null>(null);
  const [form, setForm] = React.useState<Form>(EMPTY);
  const [errors, setErrors] = React.useState<FieldErrors>({});

  const vendors = useQuery({
    queryKey: ['inventory', 'vendors', q, showInactive],
    queryFn: () => api.inventory.vendors.list({ q: q || undefined, includeInactive: showInactive, pageSize: 100 }),
    enabled: canRead,
  });

  const vendorBody = () => ({
    name: form.name,
    contactPerson: form.contactPerson || undefined,
    phone: form.phone || undefined,
    email: form.email || undefined,
    gstin: form.gstin || undefined,
    pan: form.pan || undefined,
    address: form.address || undefined,
    paymentTermsDays: Number(form.paymentTermsDays || 0),
  });
  const save = useMutation({
    mutationFn: () => {
      const body = vendorBody();
      return editing === 'new' ? api.inventory.vendors.create({ ...body, code: form.code }) : api.inventory.vendors.update((editing as inventory.Vendor).id, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'vendors'] });
      setEditing(null);
    },
  });

  const toggle = useMutation({
    mutationFn: (v: inventory.Vendor) => api.inventory.vendors.update(v.id, { isActive: !v.isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory', 'vendors'] }),
  });

  if (!canRead) return <NoAccess />;

  const open = (v: inventory.Vendor | 'new') => {
    save.reset();
    setErrors({});
    setEditing(v);
    setForm(
      v === 'new'
        ? EMPTY
        : {
            code: v.code,
            name: v.name,
            contactPerson: v.contactPerson ?? '',
            phone: v.phone ?? '',
            email: v.email ?? '',
            gstin: v.gstin ?? '',
            pan: v.pan ?? '',
            address: v.address ?? '',
            paymentTermsDays: String(v.paymentTermsDays),
          },
    );
  };
  const field = (key: keyof Form, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div>
      <Label htmlFor={`v-${key}`}>{label}</Label>
      <Input id={`v-${key}`} className="mt-2" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} />
      {errors[key] && <p className="mt-1 text-xs text-destructive">{errors[key]}</p>}
    </div>
  );

  return (
    <>
      <PageHeader
        title="Vendors"
        description="Suppliers you buy consumables, devices and drugs from."
        actions={
          canManage && (
            <Button onClick={() => open('new')}>
              <Plus /> New vendor
            </Button>
          )
        }
      />

      {editing && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{editing === 'new' ? 'New vendor' : `Edit ${editing.name}`}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault();
                const body = vendorBody();
                const r = editing === 'new' ? validate(inventory.createVendorSchema, { ...body, code: form.code }) : validate(inventory.updateVendorSchema, body);
                setErrors(r.errors ?? {});
                if (!r.errors) save.mutate();
              }}
            >
              {field('code', 'Code *', { disabled: editing !== 'new', required: true, maxLength: 30 })}
              <div className="sm:col-span-2">{field('name', 'Name *', { required: true, maxLength: 200 })}</div>
              {field('contactPerson', 'Contact person', { maxLength: 120 })}
              {field('phone', 'Phone', { type: 'tel', inputMode: 'tel', maxLength: 20 })}
              {field('email', 'Email', { type: 'email', maxLength: 254 })}
              {field('gstin', 'GSTIN', { maxLength: 15, placeholder: '27ABCDE1234F1Z5', onChange: (e) => setForm({ ...form, gstin: e.target.value.toUpperCase().trim() }) })}
              {field('pan', 'PAN', { maxLength: 10, placeholder: 'ABCDE1234F', onChange: (e) => setForm({ ...form, pan: e.target.value.toUpperCase().trim() }) })}
              {field('paymentTermsDays', 'Payment terms (days)', { type: 'number', min: 0, max: 365, step: 1 })}
              <div className="sm:col-span-3">{field('address', 'Address', { maxLength: 500 })}</div>
              {save.error && <p className="text-sm text-destructive sm:col-span-3">{errorMessage(save.error)}</p>}
              <div className="flex justify-end gap-2 sm:col-span-3">
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={save.isPending || !form.name.trim() || !form.code.trim()}>
                  {save.isPending && <Loader2 className="animate-spin" />}
                  Save
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Input className="max-w-xs" placeholder="Search name, code or GSTIN…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
        </label>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>GSTIN</TableHead>
              <TableHead>Terms</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {vendors.data?.items.length ? (
              vendors.data.items.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono text-xs">{v.code}</TableCell>
                  <TableCell>
                    <span className="font-medium">{v.name}</span> {!v.isActive && <Badge variant="destructive">Inactive</Badge>}
                  </TableCell>
                  <TableCell className="text-sm">{[v.contactPerson, v.phone].filter(Boolean).join(' · ') || '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{v.gstin ?? '—'}</TableCell>
                  <TableCell>{v.paymentTermsDays} days</TableCell>
                  <TableCell className="text-right">
                    {canManage && (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => open(v)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate(v)}>
                          {v.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  {vendors.isPending ? 'Loading…' : 'No vendors yet.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
