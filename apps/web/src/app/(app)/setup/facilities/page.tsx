'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus } from 'lucide-react';
import type { setup } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorBox, Field, S, opt, titleCase } from '@/modules/setup/ui';

function FacilityForm({ facility, onDone }: { facility?: setup.FacilityDetail; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, formState } = useForm({
    resolver: zodResolver(S.createFacilitySchema),
    defaultValues: facility
      ? { code: facility.code, name: facility.name, type: facility.type, phone: facility.phone ?? undefined, gstin: facility.gstin ?? undefined, address: facility.address ?? undefined }
      : { code: '', name: '', type: 'hospital' as const },
  });
  const { errors } = formState;
  const save = useMutation({
    mutationFn: (body: setup.CreateFacility) => (facility ? api.setup.updateFacility(facility.id, body) : api.setup.createFacility(body)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup'] });
      onDone();
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{facility ? `Edit ${facility.name}` : 'New facility'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="space-y-4">
          <ErrorBox error={save.error} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="code" label="Code *" error={errors.code} hint="Short, e.g. MAIN, BR2">
              <Input id="code" className="uppercase" aria-invalid={!!errors.code} {...register('code')} />
            </Field>
            <Field id="name" label="Name *" error={errors.name} className="sm:col-span-2">
              <Input id="name" aria-invalid={!!errors.name} {...register('name')} />
            </Field>
            <Field id="type" label="Type" error={errors.type}>
              <Select id="type" {...register('type')}>
                {S.FACILITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {titleCase(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="phone" label="Phone" error={errors.phone}>
              <Input id="phone" {...register('phone', opt)} />
            </Field>
            <Field id="gstin" label="GSTIN (if different)" error={errors.gstin}>
              <Input id="gstin" className="uppercase" aria-invalid={!!errors.gstin} {...register('gstin', opt)} />
            </Field>
            <Field id="line1" label="Address" error={errors.address?.line1} className="sm:col-span-2">
              <Input id="line1" {...register('address.line1', opt)} />
            </Field>
            <Field id="city" label="City" error={errors.address?.city}>
              <Input id="city" {...register('address.city', opt)} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onDone}>
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
  );
}

export default function FacilitiesPage() {
  const canManage = usePermission('core.facility.manage');
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState<setup.FacilityDetail | 'new' | null>(null);
  const { data, isPending, error } = useQuery({
    queryKey: ['setup', 'facilities', 'all'],
    queryFn: () => api.setup.listFacilities({ includeInactive: true }),
    enabled: canManage,
  });
  const toggle = useMutation({
    mutationFn: (f: setup.FacilityDetail) => api.setup.updateFacility(f.id, { isActive: !f.isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['setup'] }),
  });

  if (!canManage) return <NoAccess />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Facilities"
        description="Branches of your hospital. Staff roles can be limited to one facility."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> Add facility
          </Button>
        }
      />
      {editing && <FacilityForm key={editing === 'new' ? 'new' : editing.id} facility={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      <ErrorBox error={toggle.error} />
      <Card>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>GSTIN</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : (
                data.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-mono text-xs">{f.code}</TableCell>
                    <TableCell className="font-medium">{f.name}</TableCell>
                    <TableCell>{titleCase(f.type)}</TableCell>
                    <TableCell className="font-mono text-xs">{f.gstin ?? '—'}</TableCell>
                    <TableCell>{f.isActive ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(f)}>
                        <Pencil /> Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => toggle.mutate(f)} disabled={toggle.isPending}>
                        {f.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
