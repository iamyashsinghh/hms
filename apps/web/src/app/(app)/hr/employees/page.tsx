'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { hr as H } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { BulkImportButton } from '@/components/bulk-import';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CATEGORY_LABELS, EMPLOYMENT_LABELS, EmployeeStatusBadge, useDebounced } from '@/modules/hr/ui';

export default function EmployeesPage() {
  const canRead = usePermission('hr.employee.read');
  const [search, setSearch] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [status, setStatus] = React.useState<'current' | 'all' | 'exited'>('current');
  const [department, setDepartment] = React.useState('');
  const [page, setPage] = React.useState(1);
  const q = useDebounced(search.trim());

  const query: H.EmployeeQuery = { q: q || undefined, category: (category || undefined) as H.EmployeeCategory | undefined, status, department: department || undefined, page, pageSize: 50 };
  const { data, isPending, error } = useQuery({ queryKey: ['hr', 'employees', query], queryFn: () => api.hr.employees.list(query), placeholderData: keepPreviousData, enabled: canRead });
  const { data: departments } = useQuery({ queryKey: ['hr', 'departments'], queryFn: () => api.hr.departments(), enabled: canRead });

  if (!canRead) return <NoAccess />;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Employees"
        description="Everyone on the hospital's rolls: doctors, nurses, technicians, office and support staff (with or without a login)."
        actions={
          <Can permission="hr.employee.manage">
            <div className="flex gap-2">
              <BulkImportButton noun="employees" columns={H.EMPLOYEE_IMPORT_COLUMNS} run={(req) => api.hr.employees.import(req)} invalidate={[['hr']]} />
              <Link href="/hr/employees/new" className={buttonVariants()}>
                <Plus /> Add employee
              </Link>
            </div>
          </Can>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" placeholder="Name, code, mobile or designation…" className="pl-9" value={search} onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }} />
          </div>
          <Select className="w-40" value={category} aria-label="Category" onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}>
            <option value="">All categories</option>
            {H.EMPLOYEE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
          <Select className="w-44" value={department} aria-label="Department" onChange={(e) => {
              setDepartment(e.target.value);
              setPage(1);
            }}>
            <option value="">All departments</option>
            {departments?.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
          <Select className="w-36" value={status} aria-label="Status" onChange={(e) => {
              setStatus(e.target.value as typeof status);
              setPage(1);
            }}>
            <option value="current">Current staff</option>
            <option value="exited">Exited</option>
            <option value="all">Everyone</option>
          </Select>
        </div>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No employees found. Add your staff to plan rosters, track attendance and run payroll.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-xs">{e.employeeCode}</TableCell>
                    <TableCell>
                      <Link href={`/hr/employees/${e.id}`} className="font-medium hover:underline">
                        {e.fullName}
                      </Link>
                      <div className="text-xs text-muted-foreground">{CATEGORY_LABELS[e.category]}</div>
                    </TableCell>
                    <TableCell>{e.designation ?? '—'}</TableCell>
                    <TableCell>{e.department ?? '—'}</TableCell>
                    <TableCell>{EMPLOYMENT_LABELS[e.employmentType]}</TableCell>
                    <TableCell>{formatDate(e.dateOfJoining)}</TableCell>
                    <TableCell>
                      <EmployeeStatusBadge status={e.status} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
        {data && pages > 1 && (
          <div className="flex items-center justify-between border-t p-3 text-sm text-muted-foreground">
            <span>
              {data.total} employees · page {page} of {pages}
            </span>
            <span className="flex gap-2">
              <button className={buttonVariants({ variant: 'outline', size: 'sm' })} disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <button className={buttonVariants({ variant: 'outline', size: 'sm' })} disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </span>
          </div>
        )}
      </Card>
    </>
  );
}
