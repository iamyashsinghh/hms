'use client';

import type { hr as H } from '@hms/shared';
import { useAuth } from '@/lib/auth';
import { formatINR, monthLabel } from './ui';

function Line({ label, value }: { label: string; value: number }) {
  if (!value) return null;
  return (
    <div className="flex justify-between py-1">
      <span>{label}</span>
      <span className="tabular-nums">{formatINR(value)}</span>
    </div>
  );
}

/** Printable payslip (A4 portrait); the print stylesheet hides everything else on the page. */
export function PayslipView({ slip }: { slip: H.Payslip }) {
  const { user } = useAuth();
  return (
    <div id="payslip-print" className="mx-auto max-w-3xl rounded-lg border bg-card p-8 text-sm shadow-sm">
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #payslip-print, #payslip-print * { visibility: visible !important; }
        #payslip-print { position: absolute; left: 0; top: 0; width: 100%; border: 0; box-shadow: none; }
      }`}</style>
      <div className="flex items-start justify-between border-b pb-4">
        <div>
          <p className="text-lg font-semibold">{user?.tenantName}</p>
          <p className="text-muted-foreground">Payslip for {monthLabel(slip.month)}</p>
        </div>
        {slip.runStatus === 'draft' && <span className="rounded border border-destructive px-2 py-1 text-xs font-semibold text-destructive">DRAFT</span>}
      </div>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-1 border-b py-4 sm:grid-cols-3">
        {[
          ['Employee', slip.employeeName],
          ['Code', slip.employeeCode],
          ['Designation', slip.designation],
          ['Department', slip.department],
          ['PAN', slip.pan],
          ['UAN', slip.uan],
          ['Bank account', slip.bankAccountNo ? `${slip.bankAccountNo} · ${slip.bankIfsc ?? ''}` : null],
          ['Days in month', String(slip.daysInMonth)],
          ['Paid days', `${slip.payableDays}${slip.lopDays ? ` (LOP ${slip.lopDays})` : ''}`],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd>{v || '—'}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-8 py-4 sm:grid-cols-2">
        <div>
          <p className="mb-1 font-medium">Earnings</p>
          <Line label="Basic" value={slip.basic} />
          <Line label="HRA" value={slip.hra} />
          <Line label="Allowances" value={slip.otherAllowances} />
          <Line label="Other earnings" value={slip.otherEarnings} />
          <div className="mt-1 flex justify-between border-t pt-1 font-medium">
            <span>Gross</span>
            <span className="tabular-nums">{formatINR(slip.gross)}</span>
          </div>
        </div>
        <div>
          <p className="mb-1 font-medium">Deductions</p>
          <Line label="Provident fund" value={slip.pfEmployee} />
          <Line label="ESI" value={slip.esiEmployee} />
          <Line label="Professional tax" value={slip.professionalTax} />
          <Line label="TDS" value={slip.tds} />
          <Line label="Other deductions" value={slip.otherDeductions} />
          <div className="mt-1 flex justify-between border-t pt-1 font-medium">
            <span>Total deductions</span>
            <span className="tabular-nums">{formatINR(slip.totalDeductions)}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between rounded-md bg-muted/50 px-4 py-3 text-base font-semibold">
        <span>Net pay</span>
        <span className="tabular-nums">{formatINR(slip.netPay)}</span>
      </div>
      {slip.remarks && <p className="mt-3 text-muted-foreground">Note: {slip.remarks}</p>}
      <p className="mt-6 text-xs text-muted-foreground">
        Employer contributions (not deducted): PF {formatINR(slip.pfEmployer)} · ESI {formatINR(slip.esiEmployer)}. This is a computer-generated payslip.
      </p>
    </div>
  );
}
