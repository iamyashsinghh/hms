'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { useAuth, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { inr } from '@/modules/setup/ui';

export default function DoctorsPage() {
  const canRead = usePermission('setup.doctor.read');
  const { facility } = useAuth();
  const [departmentId, setDepartmentId] = React.useState('');
  const departments = useQuery({ queryKey: ['setup', 'departments'], queryFn: () => api.setup.listDepartments(), enabled: canRead });
  const { data, isPending, error } = useQuery({
    queryKey: ['setup', 'doctors', { departmentId }],
    queryFn: () => api.setup.listDoctors({ departmentId: departmentId || undefined }),
    enabled: canRead,
  });
  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader title="Doctors & OPD timings" description={`Weekly timings and leaves${facility ? ` · working in ${facility.name}` : ''}.`} />
      <Card>
        <div className="flex items-center gap-3 border-b p-4">
          <Select aria-label="Department" className="w-56" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">All departments</option>
            {departments.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Doctor</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Specialization</TableHead>
                <TableHead>Consultation</TableHead>
                <TableHead>Follow-up</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No doctors yet. Add a user with the Doctor role.
                  </TableCell>
                </TableRow>
              ) : (
                data.map((d) => (
                  <TableRow key={d.userId}>
                    <TableCell>
                      <Link href={`/setup/doctors/${d.userId}`} className="font-medium text-primary hover:underline">
                        {d.name}
                      </Link>
                      {d.qualification && <span className="ml-2 text-xs text-muted-foreground">{d.qualification}</span>}
                    </TableCell>
                    <TableCell>{d.departmentName ?? '—'}</TableCell>
                    <TableCell>{d.specialization ?? '—'}</TableCell>
                    <TableCell>{inr(d.consultationFee)}</TableCell>
                    <TableCell>
                      {d.followUpFee !== undefined ? `${inr(d.followUpFee)}${d.followUpDays ? ` within ${d.followUpDays} days` : ''}` : '—'}
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
