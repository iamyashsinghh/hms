'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CATEGORY_LABELS, ExpiryBadge, LICENCE_LABELS, Stat, todayIST } from '@/modules/hr/ui';

export default function HrHomePage() {
  const canRead = usePermission('hr.employee.read');
  const canSelf = usePermission('hr.self.use');
  const canRoster = usePermission('hr.roster.read');
  const canLeave = usePermission('hr.leave.read');
  const router = useRouter();
  const date = todayIST();

  React.useEffect(() => {
    if (!canRead && canSelf) router.replace('/hr/me');
  }, [canRead, canSelf, router]);

  const { data, error } = useQuery({ queryKey: ['hr', 'dashboard', date], queryFn: () => api.hr.dashboard(date), enabled: canRead });
  const { data: duty } = useQuery({ queryKey: ['hr', 'on-duty', date], queryFn: () => api.hr.roster.onDuty(date), enabled: canRead && canRoster });
  const { data: expiring } = useQuery({ queryKey: ['hr', 'licences', 'expiring', 30], queryFn: () => api.hr.licences.expiring(30), enabled: canRead });
  const { data: pending } = useQuery({
    queryKey: ['hr', 'leaves', { status: 'pending' }],
    queryFn: () => api.hr.leaves.list({ status: 'pending', pageSize: 5 }),
    enabled: canRead && canLeave,
  });

  if (!canRead) return canSelf ? null : <NoAccess />;

  return (
    <>
      <PageHeader
        title="HR overview"
        description={`Staff strength, today's duty and attendance, leave waiting for approval and licences about to expire · ${formatDate(date)}`}
        actions={
          <Link href="/hr/employees/new" className={buttonVariants()}>
            Add employee
          </Link>
        }
      />
      {error && <p className="mb-4 text-sm text-destructive">{errorMessage(error)}</p>}
      {data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Staff on rolls"
            value={data.headcount}
            hint={Object.entries(data.byCategory)
              .filter(([, n]) => n > 0)
              .map(([c, n]) => `${n} ${CATEGORY_LABELS[c as keyof typeof CATEGORY_LABELS].toLowerCase()}`)
              .join(' · ')}
          />
          <Stat label="On duty today" value={data.rostered} hint={`${data.present} present · ${data.absent} absent · ${data.notMarked} not marked`} />
          <Stat label="Leave to approve" value={data.pendingLeaves} hint={`${data.onLeave} on leave today`} />
          <Stat
            label="Licences"
            value={data.licencesExpired + data.licencesExpiring}
            hint={`${data.licencesExpired} expired · ${data.licencesExpiring} expire in 30 days`}
            tone={data.licencesExpired ? 'warn' : undefined}
          />
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {canRoster && (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>On duty today</CardTitle>
              <Link href="/hr/roster" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                Roster
              </Link>
            </CardHeader>
            <CardContent className="space-y-4">
              {!duty?.length && <p className="text-sm text-muted-foreground">Nobody is rostered for today yet.</p>}
              {duty?.map((row) => (
                <div key={row.shift.id}>
                  <p className="text-sm font-medium">
                    {row.shift.name} <span className="text-muted-foreground">{row.shift.startTime}–{row.shift.endTime}</span>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {row.staff.map((s) => `${s.fullName}${s.ward ? ` (${s.ward})` : ''}`).join(', ')}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {canLeave && (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Leave waiting for approval</CardTitle>
              <Link href="/hr/leaves" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                All leave
              </Link>
            </CardHeader>
            <CardContent>
              {!pending?.items.length ? (
                <p className="text-sm text-muted-foreground">Nothing pending.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {pending.items.map((l) => (
                    <li key={l.id} className="flex justify-between py-2">
                      <span>
                        <span className="font-medium">{l.employeeName}</span> · {l.leaveTypeName}
                      </span>
                      <span className="text-muted-foreground">
                        {formatDate(l.fromDate)}
                        {l.toDate !== l.fromDate && ` – ${formatDate(l.toDate)}`} ({l.days}d)
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Licences expiring in 30 days</CardTitle>
            <Link href="/hr/licences" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              All licences
            </Link>
          </CardHeader>
          {!expiring?.length ? (
            <CardContent>
              <p className="text-sm text-muted-foreground">No registrations or certificates are due.</p>
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Staff</TableHead>
                  <TableHead>Licence</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Valid until</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {expiring.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <Link href={`/hr/employees/${l.employeeId}`} className="font-medium hover:underline">
                        {l.employeeName}
                      </Link>
                    </TableCell>
                    <TableCell>{LICENCE_LABELS[l.kind]}</TableCell>
                    <TableCell className="font-mono text-xs">{l.number}</TableCell>
                    <TableCell>{formatDate(l.validUntil)}</TableCell>
                    <TableCell>
                      <ExpiryBadge daysLeft={l.daysLeft} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
