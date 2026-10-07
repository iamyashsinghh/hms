'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Search, UserPlus } from 'lucide-react';
import type { ipd as I } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebounced } from '@/modules/billing/ui';
import { AdmissionStatusBadge, ErrorBox, daysLabel, formatDateTime } from '@/modules/ipd/ui';

export default function AdmissionsPage() {
  const canRead = usePermission('ipd.admission.read');
  const canAdmit = usePermission('ipd.admission.create');
  const [status, setStatus] = React.useState<I.AdmissionStatus | ''>('admitted');
  const [term, setTerm] = React.useState('');
  const [page, setPage] = React.useState(1);
  const q = useDebounced(term.trim());
  const query: I.AdmissionQuery = { status: status || undefined, q: q || undefined, page, pageSize: 25 };
  const { data, error, isLoading } = useQuery({ queryKey: ['ipd', 'admissions', query], queryFn: () => api.ipd.admissions.list(query), enabled: canRead });

  if (!canRead) return <NoAccess />;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Admissions"
        description="Inpatients in this facility. Search by name, IPD no., UHID or mobile."
        actions={
          canAdmit && (
            <Link href="/ipd/admit" className={buttonVariants()}>
              <UserPlus /> Admit patient
            </Link>
          )
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search patients…"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          className="sm:w-48"
          aria-label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as I.AdmissionStatus | '');
            setPage(1);
          }}
        >
          <option value="admitted">In hospital</option>
          <option value="discharged">Discharged</option>
          <option value="cancelled">Cancelled</option>
          <option value="">All</option>
        </Select>
      </div>
      <ErrorBox error={error ? errorMessage(error) : null} />
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>IPD no.</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Bed</TableHead>
              <TableHead>Doctor</TableHead>
              <TableHead>Admitted</TableHead>
              <TableHead>Stay</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : !data?.items.length ? (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                  No admissions found.
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link className="font-mono text-xs text-primary hover:underline" href={`/ipd/admissions/${a.id}`}>
                      {a.ipdNo}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{a.patientName}</span> <span className="font-mono text-xs text-muted-foreground">{a.patientUhid}</span>
                    {a.isMlc && <span className="ml-2 text-xs font-medium text-destructive">MLC</span>}
                  </TableCell>
                  <TableCell>{a.bedLabel ? `${a.wardName} · ${a.bedLabel}` : '—'}</TableCell>
                  <TableCell>{a.doctorName}</TableCell>
                  <TableCell>{formatDateTime(a.admittedAt)}</TableCell>
                  <TableCell className="tabular-nums">{daysLabel(a.lengthOfStay)}</TableCell>
                  <TableCell>
                    <AdmissionStatusBadge status={a.status} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="tabular-nums">
            Page {page} of {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </>
  );
}
