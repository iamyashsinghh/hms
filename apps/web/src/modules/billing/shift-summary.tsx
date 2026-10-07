'use client';

import type { billing as B } from '@hms/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MODE_LABELS, formatDateTime, formatINR } from './ui';

export function ShiftSummary({ shift }: { shift: B.CashShift }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {shift.status === 'open' ? 'Shift open since' : 'Shift closed'} {formatDateTime(shift.status === 'open' ? shift.openedAt : shift.closedAt)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        <Line label="Opening cash" value={shift.openingCash} />
        {Object.entries(shift.totals).map(([mode, v]) => (
          <Line key={mode} label={`Net ${MODE_LABELS[mode as B.SettlementMode] ?? mode}`} value={v} />
        ))}
        <div className="flex justify-between border-t pt-2 font-semibold">
          <span>Expected cash in drawer</span>
          <span className="tabular-nums">{formatINR(shift.expectedCash)}</span>
        </div>
        {shift.countedCash !== null && <Line label="Counted" value={shift.countedCash} />}
        {shift.difference !== null && (
          <div className={`flex justify-between font-semibold ${shift.difference < 0 ? 'text-destructive' : ''}`}>
            <span>{shift.difference < 0 ? 'Short' : shift.difference > 0 ? 'Excess' : 'Difference'}</span>
            <span className="tabular-nums">{formatINR(shift.difference)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{formatINR(value)}</span>
    </div>
  );
}
