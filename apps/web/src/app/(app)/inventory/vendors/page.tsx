'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { inventory } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { BulkImportButton } from '@/components/bulk-import';
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
  const [formError, setFormError] = React.useState<string | null>(null);

  const vendors = useQuery({
    queryKey: ['inventory', 'vendors', q, showInactive],
    queryFn: () => api.inventory.vendors.list({ q: q || undefined, includeInactive: showInactive, pageSize: 100 }),
    enabled: canRead,
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        contactPerson: form.contactPerson.trim() || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        gstin: form.gstin.trim() || undefined,
        pan: form.pan.trim() || undefined,
        address: form.address.trim() || undefined,
        paymentTermsDays: Number(form.paymentTermsDays || 0),
      };
      if (editing === 'new') return api.inventory.vendors.create({ ...body, code: form.code });
      // On edit an emptied field is sent as '' so the server clears it.
      return api.inventory.vendors.update((editing as inventory.Vendor).id, {
        ...body,
        contactPerson: form.contactPerson.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        gstin: form.gstin.trim(),
        pan: form.pan.trim(),
        address: form.address.trim(),
      });
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
    setFormError(null);
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
    </div>
  );

  return (
    <>
      <PageHeader
        title="Vendors"
        description="Suppliers you buy consumables, devices and drugs from."
        actions={
          canManage && (
            <>
              <BulkImportButton noun="vendors" columns={inventory.VENDOR_IMPORT_COLUMNS} run={(req) => api.inventory.vendors.import(req)} invalidate={[['inventory', 'vendors']]} />
              <Button onClick={() => open('new')}>
                <Plus /> New vendor
              </Button>
            </>
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
                setFormError(null);
                const terms = Number(form.paymentTermsDays || 0);
                const values = {
                  code: form.code,
                  name: form.name,
                  phone: form.phone.trim() || undefined,
                  email: form.email.trim() || undefined,
                  gstin: form.gstin.trim() || undefined,
                  pan: form.pan.trim() || undefined,
                  paymentTermsDays: terms,
                };
                const parsed = (editing === 'new' ? inventory.createVendorSchema : inventory.updateVendorSchema).safeParse(values);
                if (!parsed.success) {
                  const issue = parsed.error.issues[0];
                  return setFormError(issue ? `${issue.path.join('.') || 'Vendor'}: ${issue.message}` : 'Check the vendor details');
                }
                save.mutate();
              }}
            >
              {field('code', 'Code *', { disabled: editing !== 'new', required: true })}
              <div className="sm:col-span-2">{field('name', 'Name *', { required: true })}</div>
              {field('contactPerson', 'Contact person')}
              {field('phone', 'Phone')}
              {field('email', 'Email', { type: 'email' })}
              {field('gstin', 'GSTIN', { onChange: (e) => setForm({ ...form, gstin: e.target.value.toUpperCase() }) })}
              {field('pan', 'PAN', { onChange: (e) => setForm({ ...form, pan: e.target.value.toUpperCase() }) })}
              {field('paymentTermsDays', 'Payment terms (days)', { type: 'number', min: 0, max: 365 })}
              <div className="sm:col-span-3">{field('address', 'Address')}</div>
              {(formError || save.error) && <p className="text-sm text-destructive sm:col-span-3">{formError ?? errorMessage(save.error)}</p>}
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
