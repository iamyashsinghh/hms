'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Loader2, Plus, Search } from 'lucide-react';
import type { pharmacy } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Status = NonNullable<pharmacy.PrescriptionQuery['status']>;
const STATUS_BADGE: Record<string, 'default' | 'accent' | 'secondary' | 'outline'> = { pending: 'default', partial: 'accent', dispensed: 'secondary', cancelled: 'outline' };

export default function RxQueuePage() {
  const canRead = usePermission('pharmacy.prescription.read');
  const router = useRouter();
  const [status, setStatus] = React.useState<Status>('open');
  const [search, setSearch] = React.useState('');
  const [q, setQ] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ['pharmacy', 'prescriptions', { status, q }],
    queryFn: () => api.pharmacy.prescriptions.list({ status, q: q || undefined, pageSize: 100 }),
    placeholderData: keepPreviousData,
    refetchInterval: status === 'open' ? 15_000 : false,
    enabled: canRead,
  });
  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Prescription queue"
        description="Prescriptions from doctors arrive here automatically. Paper prescriptions can be added at the counter."
        actions={
          <Can permission="pharmacy.prescription.create">
            <Link href="/pharmacy/queue/new" className={buttonVariants({ variant: 'outline' })}>
              <Plus /> Paper prescription
            </Link>
          </Can>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" placeholder="Patient name, UHID or mobile…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select aria-label="Status" className="w-40" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            <option value="open">Waiting</option>
            <option value="dispensed">Dispensed</option>
            <option value="cancelled">Cancelled</option>
          </Select>
          {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Received</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Doctor</TableHead>
                <TableHead>Drugs</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Loading…</TableCell>
                </TableRow>
              ) : data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Nothing here.</TableCell>
                </TableRow>
              ) : (
                data.items.map((rx) => (
                  <TableRow key={rx.id} className="cursor-pointer" onClick={() => router.push(`/pharmacy/queue/${rx.id}`)}>
                    <TableCell>{new Date(rx.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</TableCell>
                    <TableCell>
                      <div className="font-medium">{rx.patientName}</div>
                      <div className="font-mono text-xs text-muted-foreground">{rx.uhid}</div>
                    </TableCell>
                    <TableCell>{rx.doctorName ?? (rx.doctorId ? 'OPD doctor' : '—')}</TableCell>
                    <TableCell className="max-w-xs truncate text-sm">{rx.lines.map((l) => l.drugName).join(', ')}</TableCell>
                    <TableCell>{rx.source === 'emr' ? 'OPD' : 'Paper'}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[rx.status]}>{rx.status === 'partial' ? 'Part given' : rx.status.charAt(0).toUpperCase() + rx.status.slice(1)}</Badge>
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
