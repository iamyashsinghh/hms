'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { pharmacy } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/validate';
import { useAuth, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function StoresPage() {
  const canManage = usePermission('pharmacy.store.manage');
  const { user, facility } = useAuth();
  const queryClient = useQueryClient();
  const { data: stores, isPending, error } = useQuery({ queryKey: ['pharmacy', 'stores'], queryFn: () => api.pharmacy.stores.list(), enabled: canManage });
  const [form, setForm] = React.useState({ facilityId: '', code: '', name: '', type: 'pharmacy' as (typeof pharmacy.STORE_TYPES)[number] });
  /** Store being edited: name and type can change; code and facility are fixed (stock and documents refer to them). */
  const [editing, setEditing] = React.useState<pharmacy.Store | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const facilityId = form.facilityId || facility?.id || user?.facilities[0]?.id || '';
  const [errors, setErrors] = React.useState<FieldErrors>({});

  const create = useMutation({
    mutationFn: (body: pharmacy.CreateStore | pharmacy.UpdateStore) =>
      editing ? api.pharmacy.stores.update(editing.id, body as pharmacy.UpdateStore) : api.pharmacy.stores.create(body as pharmacy.CreateStore),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pharmacy', 'stores'] });
      setEditing(null);
      setForm((f) => ({ ...f, code: '', name: '', type: 'pharmacy' }));
    },
  });
  const startEdit = (s: pharmacy.Store) => {
    create.reset();
    setFormError(null);
    setErrors({});
    setEditing(s);
    setForm({ facilityId: s.facilityId, code: s.code, name: s.name, type: s.type });
  };
  const cancelEdit = () => {
    create.reset();
    setFormError(null);
    setErrors({});
    setEditing(null);
    setForm({ facilityId: '', code: '', name: '', type: 'pharmacy' });
  };
  const toggle = useMutation({
    mutationFn: (s: pharmacy.Store) => api.pharmacy.stores.update(s.id, { isActive: !s.isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pharmacy', 'stores'] }),
  });

  if (!canManage) return <NoAccess />;
  const facilityName = (id: string) => user?.facilities.find((f) => f.id === id)?.name ?? '—';

  return (
    <>
      <PageHeader title="Pharmacy stores" description="Each counter or store room keeps its own stock." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          {error ? (
            <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Facility</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isPending ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : !stores.length ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      No stores yet. Create the main pharmacy to start.
                    </TableCell>
                  </TableRow>
                ) : (
                  stores.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">{s.code}</TableCell>
                      <TableCell className="font-medium">
                        {s.name} {!s.isActive && <Badge variant="outline">Inactive</Badge>}
                      </TableCell>
                      <TableCell>{facilityName(s.facilityId)}</TableCell>
                      <TableCell className="capitalize">{s.type}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => startEdit(s)}>
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => toggle.mutate(s)}>
                          {s.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{editing ? `Edit store ${editing.code}` : 'New store'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                setFormError(null);
                const r = editing
                  ? validate(pharmacy.updateStoreSchema, { name: form.name, type: form.type })
                  : validate(pharmacy.createStoreSchema, { ...form, facilityId });
                setErrors(r.errors ?? {});
                if (r.errors) {
                  // Errors without a field of their own (facility) go in the line under the form.
                  const other = Object.entries(r.errors).find(([k]) => k !== 'code' && k !== 'name');
                  if (other) setFormError(other[1]);
                  return;
                }
                create.mutate(r.data);
              }}
            >
              <div>
                <Label htmlFor="facility">Facility</Label>
                <Select id="facility" className="mt-2" disabled={!!editing} value={facilityId} onChange={(e) => setForm({ ...form, facilityId: e.target.value })}>
                  {user?.facilities.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="code">Code</Label>
                <Input id="code" className="mt-2" disabled={!!editing} placeholder="MAINPH" maxLength={20} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
                {errors.code && <p className="mt-1 text-xs text-destructive">{errors.code}</p>}
              </div>
              <div>
                <Label htmlFor="name">Name</Label>
                <Input id="name" className="mt-2" placeholder="Main Pharmacy" maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name}</p>}
              </div>
              <div>
                <Label htmlFor="type">Type</Label>
                <Select id="type" className="mt-2" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as typeof form.type })}>
                  {pharmacy.STORE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </Select>
              </div>
              {(formError || create.error) && <p className="text-sm text-destructive">{formError ?? errorMessage(create.error)}</p>}
              <Button type="submit" className="w-full" disabled={create.isPending || !form.code || !form.name.trim() || !facilityId}>
                {create.isPending ? <Loader2 className="animate-spin" /> : !editing && <Plus />} {editing ? 'Save changes' : 'Create store'}
              </Button>
              {editing && (
                <Button type="button" variant="outline" className="w-full" onClick={cancelEdit}>
                  Cancel
                </Button>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
