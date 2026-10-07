'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platform } from '@hms/shared';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { consoleApi, useConsole } from '@/modules/platform/console/session';
import { ErrorBox, StatusBadge, humanize } from '@/modules/platform/ui';

export default function ConsoleUsersPage() {
  const { admin } = useConsole();
  const qc = useQueryClient();
  const isSuper = admin?.role === 'super_admin';
  const list = useQuery({ queryKey: ['console', 'admins'], queryFn: () => consoleApi.admins(), enabled: isSuper });
  const [f, setF] = React.useState({ name: '', email: '', password: '', role: 'support' as platform.PlatformAdminRole });
  const refresh = () => qc.invalidateQueries({ queryKey: ['console', 'admins'] });
  const create = useMutation({
    mutationFn: () => consoleApi.createAdmin(f),
    onSuccess: () => {
      setF({ name: '', email: '', password: '', role: 'support' });
      refresh();
    },
  });
  const update = useMutation({ mutationFn: ({ id, patch }: { id: string; patch: platform.UpdatePlatformAdmin }) => consoleApi.updateAdmin(id, patch), onSuccess: refresh });
  if (!isSuper) return <NoAccess />;
  return (
    <>
      <PageHeader title="Platform users" description="People on the HMS team who can use this console." />
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Add user</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-5">
          <Input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Input placeholder="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Input placeholder="Temporary password" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as platform.PlatformAdminRole })}>
            {platform.PLATFORM_ADMIN_ROLES.map((r) => (
              <option key={r} value={r}>
                {humanize(r)}
              </option>
            ))}
          </Select>
          <Button disabled={create.isPending} onClick={() => create.mutate()}>
            Add
          </Button>
          <div className="sm:col-span-5">
            <ErrorBox error={create.error} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <ErrorBox error={list.error ?? update.error} />
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data?.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <p className="font-medium">{a.name}</p>
                  <p className="text-xs text-muted-foreground">{a.email}</p>
                </TableCell>
                <TableCell>{humanize(a.role)}</TableCell>
                <TableCell>
                  <StatusBadge status={a.status === 'active' ? 'active' : 'closed'} />
                </TableCell>
                <TableCell>{formatDate(a.lastLoginAt)}</TableCell>
                <TableCell className="text-right">
                  {a.id !== admin?.id && (
                    <Button size="sm" variant="outline" onClick={() => update.mutate({ id: a.id, patch: { status: a.status === 'active' ? 'disabled' : 'active' } })}>
                      {a.status === 'active' ? 'Disable' : 'Enable'}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
