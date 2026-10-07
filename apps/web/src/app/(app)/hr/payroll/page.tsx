'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorBox, formatINR, monthLabel, thisMonth } from '@/modules/hr/ui';

function previousMonth() {
  const [y, m] = thisMonth().split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export default function PayrollPage() {
  const canRead = usePermission('hr.payroll.read');
  const canManage = usePermission('hr.payroll.manage');
  const router = useRouter();
  const [month, setMonth] = React.useState(previousMonth());
  const { data, isPending, error } = useQuery({ queryKey: ['hr', 'payroll'], queryFn: () => api.hr.payroll.list(), enabled: canRead });
  const create = useMutation({ mutationFn: () => api.hr.payroll.create({ month }), onSuccess: (run) => router.push(`/hr/payroll/${run.id}`) });

  if (!canRead) return <NoAccess />;
  return (
    <>
      <PageHeader
        title="Payroll"
        description="Monthly salary from each employee's structure, pro-rated for joining/exit dates and loss of pay (absences, half days, unpaid leave), with PF, ESI, PT and TDS."
      />
      {canManage && (
        <Card className="mb-6 flex flex-wrap items-end gap-3 p-4">
          <div>
            <label htmlFor="month" className="text-sm font-medium">
              Prepare payroll for
            </label>
            <Input id="month" type="month" className="mt-2 w-44" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </div>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending && <Loader2 className="animate-spin" />} Prepare {monthLabel(month)}
          </Button>
          <div className="w-full">
            <ErrorBox error={create.error ? errorMessage(create.error) : null} />
          </div>
        </Card>
      )}
      <Card>
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Month</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Staff</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Deductions</TableHead>
                <TableHead className="text-right">Net pay</TableHead>
                <TableHead className="text-right">Cost to hospital</TableHead>
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
                    No payroll yet. Set salaries on employees, then prepare a month.
                  </TableCell>
                </TableRow>
              ) : (
                data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={`/hr/payroll/${r.id}`} className="font-medium hover:underline">
                        {monthLabel(r.month)}
                      </Link>
                    </TableCell>
                    <TableCell>{r.status === 'final' ? <Badge variant="accent">Final</Badge> : <Badge variant="secondary">Draft</Badge>}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.employeeCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(r.grossTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(r.deductionTotal)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatINR(r.netTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(r.employerCostTotal)}</TableCell>
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
