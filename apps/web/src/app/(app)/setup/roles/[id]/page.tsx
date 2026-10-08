'use client';

import * as React from 'react';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, Trash2 } from 'lucide-react';
import type { setup } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { moduleName } from '@/modules';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { BackLink, ErrorBox, Field, S } from '@/modules/setup/ui';

export default function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew = id === 'new';
  const canRead = usePermission('core.role.read');
  const canManage = usePermission('core.role.manage');
  const roles = useQuery({ queryKey: ['setup', 'roles'], queryFn: () => api.setup.listRoles(), enabled: canRead });
  const catalog = useQuery({ queryKey: ['setup', 'permissions'], queryFn: () => api.setup.permissions(), enabled: canRead });
  const role = isNew ? undefined : roles.data?.find((r) => r.id === id);

  if (!canRead) return <NoAccess />;
  if (roles.isPending || catalog.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (roles.error || catalog.error) return <p className="text-sm text-destructive">{errorMessage(roles.error ?? catalog.error)}</p>;
  if (!isNew && !role) return <p className="text-sm text-destructive">Role not found.</p>;
  return <RoleEditor key={id} id={id} role={role} roles={roles.data} catalog={catalog.data} canManage={canManage} />;
}

function RoleEditor({
  id,
  role,
  roles,
  catalog,
  canManage,
}: {
  id: string;
  role?: setup.Role;
  roles: setup.Role[];
  catalog: setup.PermissionCatalogEntry[];
  canManage: boolean;
}) {
  const isNew = !role;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = React.useState(role?.name ?? '');
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(role?.permissions ?? []));

  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['setup', 'roles'] });
    router.push('/setup/roles');
  };
  const save = useMutation({
    mutationFn: async () => {
      const permissions = [...selected];
      if (isNew) return api.setup.createRole(S.createRoleSchema.parse({ name, permissions }));
      return api.setup.updateRole(id, S.updateRoleSchema.parse(role?.isSystem ? { permissions } : { name, permissions }));
    },
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: () => api.setup.deleteRole(id), onSuccess: done });

  const locked = role?.key === 'hospital_admin';
  const readOnly = !canManage || locked;
  const byModule = new Map<string, setup.PermissionCatalogEntry[]>();
  for (const p of catalog) byModule.set(p.module, [...(byModule.get(p.module) ?? []), p]);
  const toggle = (keys: string[], on: boolean) =>
    setSelected((cur) => {
      const next = new Set(cur);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <BackLink href="/setup/roles" label="All roles" />
        <PageHeader
          title={isNew ? 'New custom role' : role.name}
          description={
            locked
              ? 'Hospital Admin always has every permission and cannot be changed.'
              : role?.isSystem
                ? `${selected.size} permissions selected. This is a system role: you can change its permissions but not its name.`
                : `${selected.size} permissions selected`
          }
        />
      </div>
      <ErrorBox error={save.error ?? remove.error} />

      {!readOnly && (
        <Card>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
            <Field id="name" label="Role name *">
              <Input
                id="name"
                value={name}
                disabled={role?.isSystem}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Front Desk Lead"
              />
            </Field>
            {isNew && (
              <Field id="copy" label="Start from an existing role">
                <Select
                  id="copy"
                  defaultValue=""
                  onChange={(e) => {
                    const from = roles.find((r) => r.id === e.target.value);
                    if (from) setSelected(new Set(from.permissions));
                  }}
                >
                  <option value="">Blank</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </CardContent>
        </Card>
      )}

      {[...byModule.entries()].map(([mod, perms]) => {
        const keys = perms.map((p) => p.key);
        const all = keys.every((k) => selected.has(k));
        return (
          <Card key={mod}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>{mod === 'core' ? 'General' : moduleName(mod)}</CardTitle>
                <CardDescription>
                  {keys.filter((k) => selected.has(k)).length} of {keys.length}
                </CardDescription>
              </div>
              {!readOnly && (
                <Button variant="ghost" size="sm" onClick={() => toggle(keys, !all)}>
                  {all ? 'Clear' : 'Select all'}
                </Button>
              )}
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {perms.map((p) => (
                <label key={p.key} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5" disabled={readOnly} checked={selected.has(p.key)} onChange={(e) => toggle([p.key], e.target.checked)} />
                  <span>
                    {p.description}
                    <span className="block font-mono text-[11px] text-muted-foreground">{p.key}</span>
                  </span>
                </label>
              ))}
            </CardContent>
          </Card>
        );
      })}

      <div className="flex justify-between gap-2">
        <div>
          {canManage && role && !role.isSystem && (
            <Button variant="destructive" onClick={() => confirm(`Delete role ${role.name}?`) && remove.mutate()} disabled={remove.isPending}>
              <Trash2 /> Delete role
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          {canManage && role?.isSystem && (
            <Button
              variant="outline"
              onClick={() =>
                api.setup
                  .createRole({ name: `${role.name} (custom)`, permissions: role.permissions })
                  .then((r) => {
                    queryClient.invalidateQueries({ queryKey: ['setup', 'roles'] });
                    router.push(`/setup/roles/${r.id}`);
                  })
                  .catch((e) => alert(errorMessage(e)))
              }
            >
              <Copy /> Copy to custom role
            </Button>
          )}
          {!readOnly && (
            <Button onClick={() => save.mutate()} disabled={save.isPending || name.trim().length < 2 || selected.size === 0}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {isNew ? 'Create role' : 'Save role'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
