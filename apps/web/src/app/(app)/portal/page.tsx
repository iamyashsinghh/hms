'use client';

import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, Star, X } from 'lucide-react';
import type { portal } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

const STATUS_VARIANT: Record<string, 'secondary' | 'accent' | 'destructive' | 'outline'> = {
  requested: 'secondary',
  booked: 'accent',
  confirmed: 'accent',
  rejected: 'destructive',
  cancelled: 'outline',
};

export default function PortalAdminPage() {
  const canRead = usePermission('portal.booking.read');
  const { user } = useAuth();
  if (!canRead) return <NoAccess />;
  const link = typeof window !== 'undefined' && user ? `${window.location.origin}/p?h=${user.tenantCode}` : '';
  return (
    <>
      <PageHeader
        title="Online bookings"
        description="Appointments patients booked on the patient portal, and their feedback."
        actions={
          link && (
            <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
              Patient portal link <ExternalLink className="size-3" />
            </a>
          )
        }
      />
      <div className="space-y-6">
        <Bookings />
        <Can permission="portal.feedback.read">
          <Feedback />
        </Can>
      </div>
    </>
  );
}

function Bookings() {
  const qc = useQueryClient();
  const canManage = usePermission('portal.booking.manage');
  const [status, setStatus] = React.useState<portal.AppointmentStatus | ''>('requested');
  const [date, setDate] = React.useState('');
  const { data, isPending, error } = useQuery({
    queryKey: ['portal-staff', 'bookings', status, date],
    queryFn: () => api.portal.staff.bookings({ status: status || undefined, date: date || undefined, pageSize: 100 }),
    placeholderData: keepPreviousData,
  });
  const decide = useMutation({
    mutationFn: (v: { id: string; decision: 'confirm' | 'reject' }) => api.portal.staff.decide(v.id, { decision: v.decision }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-staff', 'bookings'] }),
  });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-end justify-between gap-3">
        <div>
          <CardTitle>Booking requests</CardTitle>
          <CardDescription>Confirm to accept the slot, or reject if the doctor is not available.</CardDescription>
        </div>
        <div className="flex gap-2">
          <Select value={status} onChange={(e) => setStatus(e.target.value as portal.AppointmentStatus | '')} className="w-40">
            <option value="">All statuses</option>
            <option value="requested">Waiting</option>
            <option value="confirmed">Confirmed</option>
            <option value="booked">Booked</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </Select>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {decide.error && <p className="px-6 pb-3 text-sm text-destructive">{errorMessage(decide.error)}</p>}
        {isPending ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : !data.items.length ? (
          <p className="p-6 text-sm text-muted-foreground">No online bookings here.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Doctor</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="whitespace-nowrap">{when(b.slotStart)}</TableCell>
                  <TableCell>{b.patientName}</TableCell>
                  <TableCell>{b.doctorName}</TableCell>
                  <TableCell className="max-w-56 truncate text-muted-foreground">{b.reason ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[b.status] ?? 'outline'} className="capitalize">
                      {b.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage && b.status === 'requested' && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: b.id, decision: 'confirm' })}>
                          <Check /> Confirm
                        </Button>
                        <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: b.id, decision: 'reject' })}>
                          <X /> Reject
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function Feedback() {
  const { data, isPending, error } = useQuery({ queryKey: ['portal-staff', 'feedback'], queryFn: () => api.portal.staff.feedback({ pageSize: 50 }) });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Patient feedback</CardTitle>
        <CardDescription>
          {data?.average != null ? `Average ${data.average} / 5 from ${data.count} ratings` : 'Ratings patients leave after their visit.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{errorMessage(error)}</p>
        ) : !data.items.length ? (
          <p className="text-sm text-muted-foreground">No feedback yet.</p>
        ) : (
          data.items.map((f) => (
            <div key={f.id} className="flex flex-wrap items-start justify-between gap-2 border-b pb-3 last:border-0">
              <div>
                <p className="text-sm font-medium">{f.patientName}</p>
                {f.comment && <p className="text-sm text-muted-foreground">{f.comment}</p>}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="flex">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} className={`size-4 ${n <= f.rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'}`} />
                  ))}
                </span>
                <span className="text-muted-foreground">{when(f.createdAt)}</span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
