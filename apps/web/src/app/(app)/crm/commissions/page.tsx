'use client';

import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Printer } from 'lucide-react';
import { crm as C } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorBox, Field, Pager, ReferrerSelect, Select, StatementStatusBadge, formatINR, todayIST } from '@/modules/crm/ui';

function lastMonth(): { from: string; to: string } {
  const t = todayIST();
  const first = new Date(`${t.slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(first.getTime() - 86_400_000);
  return { from: `${end.toISOString().slice(0, 7)}-01`, to: end.toISOString().slice(0, 10) };
}

export default function CommissionsPage() {
  const canRead = usePermission('crm.commission.read');
  const canManage = usePermission('crm.commission.manage');
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [creating, setCreating] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(null);

  const query: C.StatementQuery = { status: (status || undefined) as C.StatementStatus | undefined, page, pageSize: 25 };
  const { data, isPending, error } = useQuery({
    queryKey: ['crm', 'statements', query],
    queryFn: () => api.crm.statements.list(query),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });
  const { data: open } = useQuery({
    queryKey: ['crm', 'commissions', { state: 'open' }],
    queryFn: () => api.crm.commissions.list({ state: 'open', pageSize: 200 }),
    enabled: canRead,
  });
  const openByReferrer = React.useMemo(() => {
    const m = new Map<string, { name: string; total: number; count: number }>();
    for (const c of open?.items ?? []) {
      const x = m.get(c.referrerId) ?? { name: c.referrerName, total: 0, count: 0 };
      x.total += c.amount;
      x.count += 1;
      m.set(c.referrerId, x);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [open]);

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Referral commissions"
        description="Commission accrues when a referred patient's bill is finalized. Group it into a statement, approve, then record the payment."
        actions={
          <Can permission="crm.commission.manage">
            <Button onClick={() => setCreating(true)}>
              <Plus /> New statement
            </Button>
          </Can>
        }
      />
      {creating && canManage && (
        <NewStatement
          onClose={() => setCreating(false)}
          onSaved={(s) => {
            setCreating(false);
            setSelected(s.id);
            queryClient.invalidateQueries({ queryKey: ['crm'] });
          }}
        />
      )}
      {selected && <StatementDetail id={selected} onClose={() => setSelected(null)} />}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex items-center gap-3 border-b p-4">
            <Select
              aria-label="Status"
              className="w-40"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statements</option>
              {C.STATEMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
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
                  <TableHead>No.</TableHead>
                  <TableHead>Referrer</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isPending ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : data.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      No statements yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.items.map((s) => (
                    <TableRow key={s.id} className="cursor-pointer" onClick={() => setSelected(s.id)}>
                      <TableCell className="font-mono text-xs">{s.number}</TableCell>
                      <TableCell className="font-medium">{s.referrerName}</TableCell>
                      <TableCell>
                        {formatDate(s.periodFrom)} – {formatDate(s.periodTo)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(s.total)}</TableCell>
                      <TableCell>
                        <StatementStatusBadge status={s.status} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
          <Pager data={data} page={page} setPage={setPage} />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Not yet on a statement</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableBody>
                {openByReferrer.length === 0 ? (
                  <TableRow>
                    <TableCell className="py-6 text-center text-muted-foreground">All commission is billed.</TableCell>
                  </TableRow>
                ) : (
                  openByReferrer.map(([id, x]) => (
                    <TableRow key={id}>
                      <TableCell>
                        <div className="font-medium">{x.name}</div>
                        <div className="text-xs text-muted-foreground">{x.count} bills</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(x.total)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function NewStatement({ onClose, onSaved }: { onClose: () => void; onSaved: (s: C.CommissionStatementDetail) => void }) {
  const lm = lastMonth();
  const [referrerId, setReferrerId] = React.useState('');
  const [from, setFrom] = React.useState(lm.from);
  const [to, setTo] = React.useState(lm.to);
  const m = useMutation({ mutationFn: () => api.crm.statements.create({ referrerId, periodFrom: from, periodTo: to }), onSuccess: onSaved });
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>New commission statement</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ErrorBox error={m.error ? errorMessage(m.error) : null} />
        <div className="grid gap-4 sm:grid-cols-4">
          <Field id="st-ref" label="Referrer *" className="sm:col-span-2">
            <ReferrerSelect id="st-ref" value={referrerId} onChange={setReferrerId} allowNone={false} />
          </Field>
          <Field id="st-from" label="Bills from">
            <Input id="st-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field id="st-to" label="Bills to">
            <Input id="st-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={m.isPending || !referrerId} onClick={() => m.mutate()}>
            {m.isPending && <Loader2 className="animate-spin" />}
            Create statement
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StatementDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const canManage = usePermission('crm.commission.manage');
  const canPay = usePermission('crm.commission.pay');
  const queryClient = useQueryClient();
  const [mode, setMode] = React.useState<C.CommissionPaymentMode>('bank');
  const [reference, setReference] = React.useState('');
  const { data: s, error } = useQuery({ queryKey: ['crm', 'statement', id], queryFn: () => api.crm.statements.get(id) });
  const act = useMutation({
    mutationFn: (what: 'approve' | 'pay' | 'cancel') =>
      what === 'approve' ? api.crm.statements.approve(id) : what === 'cancel' ? api.crm.statements.cancel(id) : api.crm.statements.pay(id, { mode, reference: reference || null }),
    onSuccess: (x) => {
      queryClient.setQueryData(['crm', 'statement', id], x);
      queryClient.invalidateQueries({ queryKey: ['crm', 'statements'] });
      queryClient.invalidateQueries({ queryKey: ['crm', 'commissions'] });
    },
  });

  return (
    <Card className="mb-6 print:border-0 print:shadow-none">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>
            {s ? `Statement ${s.number} · ${s.referrerName}` : 'Statement'} {s && <StatementStatusBadge status={s.status} />}
          </CardTitle>
          {s && (
            <p className="mt-1 text-sm text-muted-foreground">
              Bills {formatDate(s.periodFrom)} – {formatDate(s.periodTo)}
              {s.paidAt && ` · paid ${formatDate(s.paidAt)} by ${s.paymentMode}${s.paymentRef ? ` (${s.paymentRef})` : ''}`}
            </p>
          )}
        </div>
        <div className="flex gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer /> Print
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{errorMessage(error)}</p>}
        <ErrorBox error={act.error ? errorMessage(act.error) : null} />
        {s && (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Bill</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead className="text-right">Bill amount</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.commissions.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">
                      {c.invoiceNumber}
                      {c.kind === 'reversal' && <Badge variant="destructive" className="ml-2">Reversal</Badge>}
                    </TableCell>
                    <TableCell>{formatDate(c.invoiceDate)}</TableCell>
                    <TableCell>{c.patientName}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(c.baseAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(c.amount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="text-right font-medium">
                    Total
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatINR(s.total)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <div className="flex flex-wrap items-end justify-end gap-2 print:hidden">
              {s.status === 'draft' && canManage && (
                <>
                  <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate('cancel')}>
                    Cancel statement
                  </Button>
                  <Button disabled={act.isPending} onClick={() => act.mutate('approve')}>
                    Approve
                  </Button>
                </>
              )}
              {s.status === 'approved' && (
                <>
                  {canManage && (
                    <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate('cancel')}>
                      Cancel statement
                    </Button>
                  )}
                  {canPay && (
                    <>
                      <Select aria-label="Payment mode" className="w-32" value={mode} onChange={(e) => setMode(e.target.value as C.CommissionPaymentMode)}>
                        {C.COMMISSION_PAYMENT_MODES.map((m) => (
                          <option key={m} value={m}>
                            {m.toUpperCase()}
                          </option>
                        ))}
                      </Select>
                      <Input aria-label="Reference" className="w-48" placeholder="UTR / cheque no." value={reference} onChange={(e) => setReference(e.target.value)} />
                      <Button disabled={act.isPending} onClick={() => act.mutate('pay')}>
                        Mark paid
                      </Button>
                    </>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
