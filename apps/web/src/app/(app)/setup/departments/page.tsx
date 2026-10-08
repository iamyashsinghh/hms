'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Pencil, Plus, X } from 'lucide-react';
import type { setup } from '@hms/shared';
import { api } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorBox, S, titleCase } from '@/modules/setup/ui';

/** Common Indian hospital departments to add in one click. */
const SUGGESTED: { code: string; name: string; type: setup.CreateDepartment['type'] }[] = [
  { code: 'GENMED', name: 'General Medicine', type: 'clinical' },
  { code: 'GENSURG', name: 'General Surgery', type: 'clinical' },
  { code: 'PAED', name: 'Paediatrics', type: 'clinical' },
  { code: 'OBG', name: 'Obstetrics & Gynaecology', type: 'clinical' },
  { code: 'ORTHO', name: 'Orthopaedics', type: 'clinical' },
  { code: 'ENT', name: 'ENT', type: 'clinical' },
  { code: 'DERM', name: 'Dermatology', type: 'clinical' },
  { code: 'CARDIO', name: 'Cardiology', type: 'clinical' },
  { code: 'PATH', name: 'Pathology / Lab', type: 'diagnostic' },
  { code: 'RADIO', name: 'Radiology', type: 'diagnostic' },
  { code: 'PHARM', name: 'Pharmacy', type: 'support' },
  { code: 'ADMIN', name: 'Administration', type: 'administrative' },
];

export default function DepartmentsPage() {
  const canManage = usePermission('setup.department.manage');
  const queryClient = useQueryClient();
  const [dept, setDept] = React.useState({ code: '', name: '', type: 'clinical' as setup.CreateDepartment['type'] });
  const [spec, setSpec] = React.useState({ code: '', name: '' });

  const departments = useQuery({ queryKey: ['setup', 'departments', 'all'], queryFn: () => api.setup.listDepartments({ includeInactive: true }), enabled: canManage });
  const specializations = useQuery({ queryKey: ['setup', 'specializations', 'all'], queryFn: () => api.setup.listSpecializations({ includeInactive: true }), enabled: canManage });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['setup'] });

  const addDept = useMutation({
    mutationFn: async (body: setup.CreateDepartment) => api.setup.createDepartment(S.createDepartmentSchema.parse(body)),
    onSuccess: () => {
      setDept({ code: '', name: '', type: 'clinical' });
      refresh();
    },
  });
  const toggleDept = useMutation({ mutationFn: (d: setup.Department) => api.setup.updateDepartment(d.id, { isActive: !d.isActive }), onSuccess: refresh });
  const [editDept, setEditDept] = React.useState<{ id: string; name: string; type: setup.CreateDepartment['type'] } | null>(null);
  const saveDept = useMutation({
    mutationFn: async (d: { id: string; name: string; type: setup.CreateDepartment['type'] }) =>
      api.setup.updateDepartment(d.id, S.updateDepartmentSchema.parse({ name: d.name, type: d.type })),
    onSuccess: () => {
      setEditDept(null);
      refresh();
    },
  });
  const addSpec = useMutation({
    mutationFn: async (body: setup.CreateSpecialization) => api.setup.createSpecialization(S.createSpecializationSchema.parse(body)),
    onSuccess: () => {
      setSpec({ code: '', name: '' });
      refresh();
    },
  });
  const toggleSpec = useMutation({ mutationFn: (s: setup.Specialization) => api.setup.updateSpecialization(s.id, { isActive: !s.isActive }), onSuccess: refresh });
  const [editSpec, setEditSpec] = React.useState<{ id: string; name: string } | null>(null);
  const saveSpec = useMutation({
    mutationFn: async (s: { id: string; name: string }) => api.setup.updateSpecialization(s.id, S.updateSpecializationSchema.parse({ name: s.name })),
    onSuccess: () => {
      setEditSpec(null);
      refresh();
    },
  });

  if (!canManage) return <NoAccess />;

  const existing = new Set(departments.data?.map((d) => d.code));
  const suggestions = SUGGESTED.filter((s) => !existing.has(s.code));

  return (
    <div className="space-y-6">
      <PageHeader title="Departments & specializations" description="Used for doctor lists, OPD queues and reports." />

      <Card>
        <CardHeader>
          <CardTitle>Departments</CardTitle>
          {suggestions.length > 0 && (
            <CardDescription className="flex flex-wrap items-center gap-1.5 pt-2">
              Quick add:
              {suggestions.map((s) => (
                <button key={s.code} type="button" className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-muted" onClick={() => addDept.mutate(s)} disabled={addDept.isPending}>
                  + {s.name}
                </button>
              ))}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="grid gap-2 sm:grid-cols-[8rem_1fr_10rem_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              addDept.mutate(dept);
            }}
          >
            <Input placeholder="Code" aria-label="Department code" className="uppercase" value={dept.code} onChange={(e) => setDept({ ...dept, code: e.target.value })} />
            <Input placeholder="Department name" aria-label="Department name" value={dept.name} onChange={(e) => setDept({ ...dept, name: e.target.value })} />
            <Select aria-label="Type" value={dept.type} onChange={(e) => setDept({ ...dept, type: e.target.value as typeof dept.type })}>
              {S.DEPARTMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {titleCase(t)}
                </option>
              ))}
            </Select>
            <Button type="submit" disabled={addDept.isPending || !dept.code || dept.name.length < 2}>
              {addDept.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Add
            </Button>
          </form>
          <ErrorBox error={addDept.error ?? toggleDept.error ?? saveDept.error} />
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Staff</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {departments.data?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No departments yet. Use quick add above.
                  </TableCell>
                </TableRow>
              )}
              {departments.data?.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">{d.code}</TableCell>
                  {editDept?.id === d.id ? (
                    <>
                      <TableCell>
                        <Input aria-label="Department name" value={editDept.name} maxLength={120} onChange={(e) => setEditDept({ ...editDept, name: e.target.value })} />
                      </TableCell>
                      <TableCell>
                        <Select aria-label="Type" value={editDept.type} onChange={(e) => setEditDept({ ...editDept, type: e.target.value as typeof editDept.type })}>
                          {S.DEPARTMENT_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {titleCase(t)}
                            </option>
                          ))}
                        </Select>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="font-medium">{d.name}</TableCell>
                      <TableCell>{titleCase(d.type)}</TableCell>
                    </>
                  )}
                  <TableCell>{d.staffCount}</TableCell>
                  <TableCell>{d.isActive ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {editDept?.id === d.id ? (
                      <>
                        <Button size="sm" onClick={() => saveDept.mutate(editDept)} disabled={saveDept.isPending || editDept.name.trim().length < 2}>
                          {saveDept.isPending ? <Loader2 className="animate-spin" /> : <Check />} Save
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditDept(null)}>
                          <X /> Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => setEditDept({ id: d.id, name: d.name, type: d.type })}>
                          <Pencil /> Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => toggleDept.mutate(d)}>
                          {d.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Specializations</CardTitle>
          <CardDescription>Shown next to a doctor&apos;s name, e.g. Cardiology, Neurology.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="grid gap-2 sm:grid-cols-[8rem_1fr_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              addSpec.mutate(spec);
            }}
          >
            <Input placeholder="Code" aria-label="Specialization code" className="uppercase" value={spec.code} onChange={(e) => setSpec({ ...spec, code: e.target.value })} />
            <Input placeholder="Specialization name" aria-label="Specialization name" value={spec.name} onChange={(e) => setSpec({ ...spec, name: e.target.value })} />
            <Button type="submit" disabled={addSpec.isPending || !spec.code || spec.name.length < 2}>
              {addSpec.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Add
            </Button>
          </form>
          <ErrorBox error={addSpec.error ?? toggleSpec.error ?? saveSpec.error} />
          <div className="flex flex-wrap gap-2">
            {specializations.data?.map((s) =>
              editSpec?.id === s.id ? (
                <form
                  key={s.id}
                  className="flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveSpec.mutate(editSpec);
                  }}
                >
                  <Input aria-label="Specialization name" className="h-8 w-48" autoFocus maxLength={120} value={editSpec.name} onChange={(e) => setEditSpec({ ...editSpec, name: e.target.value })} />
                  <Button type="submit" size="sm" aria-label="Save" disabled={saveSpec.isPending || editSpec.name.trim().length < 2}>
                    {saveSpec.isPending ? <Loader2 className="animate-spin" /> : <Check />}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" aria-label="Cancel" onClick={() => setEditSpec(null)}>
                    <X />
                  </Button>
                </form>
              ) : (
                <span key={s.id} className="inline-flex items-center">
                  <button
                    type="button"
                    title={s.isActive ? 'Click to deactivate' : 'Click to activate'}
                    onClick={() => toggleSpec.mutate(s)}
                    className={s.isActive ? 'rounded-l-full bg-primary/10 py-1 pl-3 pr-2 text-sm text-primary' : 'rounded-l-full bg-muted py-1 pl-3 pr-2 text-sm text-muted-foreground line-through'}
                  >
                    {s.name}
                  </button>
                  <button
                    type="button"
                    title="Rename"
                    aria-label={`Rename ${s.name}`}
                    onClick={() => setEditSpec({ id: s.id, name: s.name })}
                    className="rounded-r-full bg-muted py-1 pl-1.5 pr-2.5 text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                </span>
              ),
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
