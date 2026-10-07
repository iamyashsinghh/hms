'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import type { setup } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { S, StatusBadge, inr, titleCase } from '@/modules/setup/ui';

export default function StaffPage() {
  const canRead = usePermission('setup.staff.read');
  const [search, setSearch] = React.useState('');
  const [q, setQ] = React.useState('');
  const [departmentId, setDepartmentId] = React.useState('');
  const [staffType, setStaffType] = React.useState<setup.StaffQuery['staffType'] | ''>('');
  React.useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const departments = useQuery({ queryKey: ['setup', 'departments'], queryFn: () => api.setup.listDepartments(), enabled: canRead });
  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ['setup', 'staff', { q, departmentId, staffType }],
    queryFn: () => api.setup.listStaff({ q: q || undefined, departmentId: departmentId || undefined, staffType: staffType || undefined }),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });
  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader title="Staff profiles" description="Designation, department, council registration and doctor fees." />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" placeholder="Name, email, mobile, emp. code…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select aria-label="Department" className="w-48" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">All departments</option>
            {departments.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Staff type" className="w-40" value={staffType} onChange={(e) => setStaffType(e.target.value as typeof staffType)}>
            <option value="">All types</option>
            {S.STAFF_TYPES.map((t) => (
              <option key={t} value={t}>
                {titleCase(t)}
              </option>
            ))}
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
                <TableHead>Type / designation</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Reg. no</TableHead>
                <TableHead>Fee</TableHead>
                <TableHead>Status</TableHead>
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
                data.map((s) => (
                  <TableRow key={s.userId}>
                    <TableCell>
                      <Link href={`/setup/staff/${s.userId}`} className="font-medium text-primary hover:underline">
                        {s.name}
                      </Link>
                      {s.profile?.employeeCode && <span className="ml-2 font-mono text-xs text-muted-foreground">{s.profile.employeeCode}</span>}
                    </TableCell>
                    <TableCell>
                      {s.profile ? (
                        <>
                          {titleCase(s.profile.staffType)}
                          {s.profile.designation && <span className="text-muted-foreground"> · {s.profile.designation}</span>}
                        </>
                      ) : (
                        <Badge variant="secondary">No profile</Badge>
                      )}
                    </TableCell>
                    <TableCell>{s.profile?.departmentName ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{s.profile?.registrationNo ?? '—'}</TableCell>
                    <TableCell>{s.profile?.consultationFee != null ? inr(s.profile.consultationFee) : '—'}</TableCell>
                    <TableCell>
                      <StatusBadge status={s.status} />
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
