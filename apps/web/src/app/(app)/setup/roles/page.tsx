'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function RolesPage() {
  const canRead = usePermission('core.role.read');
  const canManage = usePermission('core.role.manage');
  const { data, isPending, error } = useQuery({ queryKey: ['setup', 'roles'], queryFn: () => api.setup.listRoles(), enabled: canRead });
  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Roles"
        description="System roles come ready-made and their permissions can be changed. Create custom roles for anything else."
        actions={
          <Can permission="core.role.manage">
            <Link href="/setup/roles/new" className={buttonVariants()}>
              <Plus /> New custom role
            </Link>
          </Can>
        }
      />
      <Card>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Role</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Active users</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : (
                data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={`/setup/roles/${r.id}`} className="font-medium text-primary hover:underline">
                        {r.name}
                      </Link>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{r.key}</span>
                    </TableCell>
                    <TableCell>{r.isSystem ? <Badge variant="secondary">System</Badge> : <Badge variant="accent">Custom</Badge>}</TableCell>
                    <TableCell>{r.permissions.length}</TableCell>
                    <TableCell>{r.userCount}</TableCell>
                    <TableCell className="text-right">
                      {canManage && r.key !== 'hospital_admin' && (
                        <Link href={`/setup/roles/${r.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                          <Pencil /> Edit
                        </Link>
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
