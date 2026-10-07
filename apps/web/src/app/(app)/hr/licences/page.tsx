'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExpiryBadge, LICENCE_LABELS } from '@/modules/hr/ui';

export default function LicencesPage() {
  const canRead = usePermission('hr.employee.read');
  const [days, setDays] = React.useState(90);
  const { data, isPending, error } = useQuery({ queryKey: ['hr', 'licences', 'expiring', days], queryFn: () => api.hr.licences.expiring(days), enabled: canRead });
  if (!canRead) return <NoAccess />;
  return (
    <>
      <PageHeader title="Licence expiry" description="Council registrations and certificates of current staff that have expired or will expire soon. Add licences on each employee's page." />
      <Card>
        <div className="flex items-center gap-3 border-b p-4">
          <span className="text-sm text-muted-foreground">Expiring within</span>
          <Select className="w-40" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Window">
            {[30, 60, 90, 180, 365].map((d) => (
              <option key={d} value={d}>
                {d} days
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
                <TableHead>Staff</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Licence</TableHead>
                <TableHead>Number</TableHead>
                <TableHead>Issued by</TableHead>
                <TableHead>Valid until</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Nothing expires in this window.
                  </TableCell>
                </TableRow>
              ) : (
                data.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <Link href={`/hr/employees/${l.employeeId}`} className="font-medium hover:underline">
                        {l.employeeName}
                      </Link>{' '}
                      <span className="font-mono text-xs text-muted-foreground">{l.employeeCode}</span>
                    </TableCell>
                    <TableCell>{l.designation ?? '—'}</TableCell>
                    <TableCell>{LICENCE_LABELS[l.kind]}</TableCell>
                    <TableCell className="font-mono text-xs">{l.number}</TableCell>
                    <TableCell>{l.issuedBy ?? '—'}</TableCell>
                    <TableCell>{formatDate(l.validUntil)}</TableCell>
                    <TableCell>
                      <ExpiryBadge daysLeft={l.daysLeft} />
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
