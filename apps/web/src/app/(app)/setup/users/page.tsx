'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Loader2, Plus, Search } from 'lucide-react';
import type { setup } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { StatusBadge } from '@/modules/setup/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function UsersPage() {
  const canRead = usePermission('core.user.read');
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState<setup.UserStatus | ''>('');
  const [q, setQ] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ['setup', 'users', { q, status }],
    queryFn: () => api.setup.listUsers({ q: q || undefined, status: status || undefined, pageSize: 200 }),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone who can sign in to your hospital, with their roles per facility."
        actions={
          <Can permission="core.user.manage">
            <Link href="/setup/users/new" className={buttonVariants()}>
              <Plus /> Add user
            </Link>
          </Can>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" placeholder="Name, email or mobile…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select aria-label="Status" className="w-40" value={status} onChange={(e) => setStatus(e.target.value as setup.UserStatus | '')}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </Select>
          {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Login</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last login</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No users found.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <Link href={`/setup/users/${u.id}`} className="font-medium text-primary hover:underline">
                        {u.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      {u.email ?? ''}
                      {u.email && u.mobile ? ' · ' : ''}
                      {u.mobile ?? ''}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map((r) => (
                          <Badge key={`${r.roleId}:${r.facilityId}`} variant="outline">
                            {r.roleName}
                            {r.facilityName ? ` · ${r.facilityName}` : ''}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell><StatusBadge status={u.status} /></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{u.lastLoginAt ? formatDate(u.lastLoginAt) : 'Never'}</TableCell>
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
