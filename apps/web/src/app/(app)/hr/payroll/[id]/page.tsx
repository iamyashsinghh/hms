'use client';

import * as React from 'react';
import Link from 'next/link';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, Loader2, Lock, RefreshCw, Trash2 } from 'lucide-react';
import type { hr as H } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { downloadText, ErrorBox, formatINR, monthLabel, Stat } from '@/modules/hr/ui';

export default function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('hr.payroll.read');
  const canManage = usePermission('hr.payroll.manage');
  const canFinalize = usePermission('hr.payroll.finalize');
  const router = useRouter();
  const queryClient = useQueryClient();
  const key = ['hr', 'payroll', id];
  const { data: run, isPending, error } = useQuery({ queryKey: key, queryFn: () => api.hr.payroll.get(id), enabled: canRead });
  const done = (next: H.PayrollRun) => {
    queryClient.setQueryData(key, next);
    queryClient.invalidateQueries({ queryKey: ['hr', 'payroll'], exact: true });
  };
  const recalc = useMutation({ mutationFn: () => api.hr.payroll.recalculate(id), onSuccess: done });
  const finalize = useMutation({ mutationFn: () => api.hr.payroll.finalize(id), onSuccess: done });
  const remove = useMutation({
    mutationFn: () => api.hr.payroll.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr', 'payroll'] });
      router.push('/hr/payroll');
    },
  });
  const exportCsv = useMutation({ mutationFn: () => api.hr.payroll.export(id), onSuccess: (x) => downloadText(x.filename, x.csv) });
  const adjust = useMutation({
    mutationFn: ({ slipId, body }: { slipId: string; body: H.AdjustPayslip }) => api.hr.payroll.adjust(slipId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  if (!canRead) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;

  const draft = run.status === 'draft';
  const err = recalc.error ?? finalize.error ?? remove.error ?? exportCsv.error ?? adjust.error;

  return (
    <div className="space-y-6">
      <Link href="/hr/payroll" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
        <ArrowLeft /> Payroll
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            Payroll · {monthLabel(run.month)} {draft ? <Badge variant="secondary">Draft</Badge> : <Badge variant="accent">Final</Badge>}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {draft ? 'Check attendance, add bonuses or deductions, then finalize. Finalized payroll is locked and visible to staff.' : `Finalized ${formatDate(run.finalizedAt)}. Payslips are locked.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => exportCsv.mutate()} disabled={exportCsv.isPending}>
            <Download /> Bank / accounts CSV
          </Button>
          {draft && canManage && (
            <>
              <Button variant="outline" onClick={() => recalc.mutate()} disabled={recalc.isPending}>
                {recalc.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Recalculate
              </Button>
              <Button variant="ghost" aria-label="Delete draft" onClick={() => window.confirm('Delete this draft payroll?') && remove.mutate()}>
                <Trash2 />
              </Button>
            </>
          )}
          {draft && canFinalize && (
            <Button
              onClick={() => window.confirm(`Finalize ${monthLabel(run.month)} payroll for ${run.employeeCount} staff? This cannot be undone.`) && finalize.mutate()}
              disabled={finalize.isPending}
            >
              {finalize.isPending ? <Loader2 className="animate-spin" /> : <Lock />} Finalize
            </Button>
          )}
        </div>
      </div>
      <ErrorBox error={err ? errorMessage(err) : null} />
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Staff paid" value={run.employeeCount} />
        <Stat label="Gross" value={formatINR(run.grossTotal)} />
        <Stat label="Net pay" value={formatINR(run.netTotal)} hint={`${formatINR(run.deductionTotal)} deducted`} />
        <Stat label="Cost to hospital" value={formatINR(run.employerCostTotal)} hint="Gross + employer PF and ESI" />
      </div>
      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Staff</TableHead>
                <TableHead className="text-right">Paid days</TableHead>
                <TableHead className="text-right">Fixed pay</TableHead>
                <TableHead className="text-right">Other earnings</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">PF</TableHead>
                <TableHead className="text-right">ESI</TableHead>
                <TableHead className="text-right">PT</TableHead>
                <TableHead className="text-right">TDS</TableHead>
                <TableHead className="text-right">Other ded.</TableHead>
                <TableHead className="text-right">Net pay</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.payslips.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="font-medium">{s.employeeName}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.employeeCode}
                      {s.remarks && ` · ${s.remarks}`}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.payableDays}/{s.daysInMonth}
                    {s.lopDays > 0 && <div className="text-xs text-destructive">LOP {s.lopDays}</div>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(s.basic + s.hra + s.otherAllowances)}</TableCell>
                  <TableCell className="text-right">
                    <MoneyCell value={s.otherEarnings} editable={draft && canManage} onSave={(v) => adjust.mutate({ slipId: s.id, body: { otherEarnings: v } })} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(s.gross)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(s.pfEmployee)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(s.esiEmployee)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(s.professionalTax)}</TableCell>
                  <TableCell className="text-right">
                    <MoneyCell value={s.tds} editable={draft && canManage} onSave={(v) => adjust.mutate({ slipId: s.id, body: { tds: v } })} />
                  </TableCell>
                  <TableCell className="text-right">
                    <MoneyCell value={s.otherDeductions} editable={draft && canManage} onSave={(v) => adjust.mutate({ slipId: s.id, body: { otherDeductions: v } })} />
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatINR(s.netPay)}</TableCell>
                  <TableCell>
                    <Link href={`/hr/payslips/${s.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                      Payslip
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function MoneyCell({ value, editable, onSave }: { value: number; editable: boolean; onSave: (v: number) => void }) {
  if (!editable) return <span className="tabular-nums">{formatINR(value)}</span>;
  return (
    <Input
      type="number"
      min={0}
      max={99999999.99}
      step="0.01"
      defaultValue={value || ''}
      placeholder="0"
      className="ml-auto h-8 w-24 text-right text-xs"
      onBlur={(e) => {
        const v = Number(e.target.value || 0);
        // Amounts are rupees with up to 2 decimals and never negative; the API gives the message otherwise.
        if (!Number.isFinite(v) || v < 0) {
          e.target.value = value ? String(value) : '';
          return;
        }
        if (v !== value) onSave(v);
      }}
    />
  );
}
