'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Pencil, Plus, UserPlus } from 'lucide-react';
import { crm as C, type Patient } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorBox, Field, PatientPicker, REFERRER_TYPE_LABELS, RULE_SCOPE_LABELS, Select, StatTile, firstIssue, formatINR, todayIST } from '@/modules/crm/ui';
import { ReferrerForm } from '../referrer-form';

export default function ReferrerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('crm.referrer.read');
  const canManage = usePermission('crm.referrer.manage');
  const canRefer = usePermission('crm.referral.create');
  const canSeeMoney = usePermission('crm.commission.read');
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState(false);
  const [editingRule, setEditingRule] = React.useState<C.CommissionRule | null>(null);

  const { data: r, error } = useQuery({ queryKey: ['crm', 'referrer', id], queryFn: () => api.crm.referrers.get(id), enabled: canRead });
  const { data: rules } = useQuery({ queryKey: ['crm', 'rules', id], queryFn: () => api.crm.rules.list(id), enabled: canRead });
  const { data: referrals } = useQuery({ queryKey: ['crm', 'referrals', { referrerId: id }], queryFn: () => api.crm.referrals.list({ referrerId: id, pageSize: 50 }), enabled: canRead });
  const { data: commissions } = useQuery({
    queryKey: ['crm', 'commissions', { referrerId: id }],
    queryFn: () => api.crm.commissions.list({ referrerId: id, pageSize: 50 }),
    enabled: canSeeMoney,
  });
  const update = useMutation({
    mutationFn: (body: C.ReferrerInput) => api.crm.referrers.update(id, body),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['crm'] });
    },
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['crm'] });

  if (!canRead) return <NoAccess />;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  if (!r) return <Loader2 className="mx-auto mt-10 size-6 animate-spin text-muted-foreground" />;

  return (
    <>
      <Link href="/crm/referrers" className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'mb-2 -ml-2' })}>
        <ArrowLeft /> Referrers
      </Link>
      <PageHeader
        title={r.name}
        description={[r.code, REFERRER_TYPE_LABELS[r.type], r.organization, r.city, r.mobile].filter(Boolean).join(' · ')}
        actions={
          <>
            {!r.isActive && <Badge variant="secondary">Inactive</Badge>}
            {canManage && !editing && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            )}
          </>
        }
      />
      {editing && <ReferrerForm title="Edit referrer" initial={r} saving={update.isPending} error={update.error} onCancel={() => setEditing(false)} onSave={(b) => update.mutate(b)} />}

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <StatTile label="Patients referred" value={r.referralCount} />
        {canSeeMoney && (
          <>
            <StatTile label="Accrued" value={formatINR(r.openCommission)} hint="Not yet on a statement" />
            <StatTile label="Payable" value={formatINR(r.payableCommission)} hint="Approved, not paid" />
            <StatTile label="Paid" value={formatINR(r.paidCommission)} />
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Commission rules</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              The most specific rule wins: this referrer&apos;s own rules over hospital defaults; a service code over a department over all bills.
            </p>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Applies to</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>Whose</TableHead>
                  {canManage && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {!rules?.length ? (
                  <TableRow>
                    <TableCell colSpan={canManage ? 5 : 4} className="py-6 text-center text-muted-foreground">
                      No rules: this referrer earns nothing yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  rules.map((x) => (
                    <TableRow key={x.id} className={x.isActive ? '' : 'opacity-50'}>
                      <TableCell>
                        {RULE_SCOPE_LABELS[x.appliesTo]}
                        {x.serviceCode && <span className="font-mono text-xs"> · {x.serviceCode}</span>}
                      </TableCell>
                      <TableCell className="tabular-nums">{x.rateType === 'percent' ? `${x.rate}%` : `${formatINR(x.rate)} / item`}</TableCell>
                      <TableCell>
                        {formatDate(x.effectiveFrom)}
                        {x.effectiveTo && ` – ${formatDate(x.effectiveTo)}`}
                      </TableCell>
                      <TableCell>{x.referrerId ? 'This referrer' : <Badge variant="outline">Hospital default</Badge>}</TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" aria-label="Edit rule" onClick={() => setEditingRule(x)}>
                            <Pencil />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            {canManage && editingRule && <RuleForm key={editingRule.id} referrerId={id} initial={editingRule} onSaved={refresh} onCancel={() => setEditingRule(null)} />}
            {canManage && !editingRule && <RuleForm referrerId={id} onSaved={refresh} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Referred patients</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {canRefer && r.isActive && <AddReferral referrerId={id} onSaved={refresh} />}
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Patient</TableHead>
                  <TableHead>Referred</TableHead>
                  <TableHead>Earns until</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!referrals?.items.length ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                      No referrals yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  referrals.items.map((x) => (
                    <TableRow key={x.id}>
                      <TableCell>
                        <Link href={`/patients/${x.patientId}`} className="font-medium text-primary hover:underline">
                          {x.patientName}
                        </Link>{' '}
                        <span className="font-mono text-xs text-muted-foreground">{x.patientUhid}</span>
                      </TableCell>
                      <TableCell>{formatDate(x.referredOn)}</TableCell>
                      <TableCell>{x.status === 'closed' ? <Badge variant="secondary">Closed</Badge> : x.validUntil ? formatDate(x.validUntil) : 'No end'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {canSeeMoney && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Commission ledger</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Bill</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead className="text-right">Bill amount</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead>Statement</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!commissions?.items.length ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                      Nothing accrued yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  commissions.items.map((c) => (
                    <TableRow key={c.id} className={c.status === 'cancelled' ? 'opacity-50' : ''}>
                      <TableCell className="font-mono text-xs">
                        {c.invoiceNumber}
                        {c.kind === 'reversal' && <Badge variant="destructive" className="ml-2">Reversal</Badge>}
                        {c.status === 'cancelled' && <Badge variant="secondary" className="ml-2">Cancelled</Badge>}
                      </TableCell>
                      <TableCell>{formatDate(c.invoiceDate)}</TableCell>
                      <TableCell>{c.patientName}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(c.baseAmount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(c.amount)}</TableCell>
                      <TableCell>{c.statementNumber ?? '—'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}

const RULE_LABELS: Record<string, string> = { rate: 'Rate', effectiveFrom: 'From', effectiveTo: 'Until', serviceCode: 'Service code' };

/** Add a commission rule; with `initial` it edits that rule (rate, scope, dates, active). */
function RuleForm({ referrerId, initial, onSaved, onCancel }: { referrerId: string; initial?: C.CommissionRule; onSaved: () => void; onCancel?: () => void }) {
  const [open, setOpen] = React.useState(!!initial);
  const blank = () => ({
    forAll: initial ? !initial.referrerId : false,
    appliesTo: initial?.appliesTo ?? ('all' as C.RuleScope),
    serviceCode: initial?.serviceCode ?? '',
    rateType: initial?.rateType ?? ('percent' as C.RateType),
    rate: initial ? String(initial.rate) : '',
    effectiveFrom: initial?.effectiveFrom ?? todayIST(),
    effectiveTo: initial?.effectiveTo ?? '',
    isActive: initial?.isActive ?? true,
  });
  const [f, setF] = React.useState(blank);
  const [invalid, setInvalid] = React.useState<string | null>(null);
  const body = (): C.CommissionRuleInput => ({
    referrerId: f.forAll ? null : referrerId,
    appliesTo: f.appliesTo,
    serviceCode: f.serviceCode || null,
    rateType: f.rateType,
    rate: f.rate === '' ? Number.NaN : Number(f.rate),
    effectiveFrom: f.effectiveFrom,
    effectiveTo: f.effectiveTo || null,
    isActive: f.isActive,
  });
  const m = useMutation({
    mutationFn: (b: C.CommissionRuleInput) => (initial ? api.crm.rules.update(initial.id, b) : api.crm.rules.create(b)),
    onSuccess: () => {
      if (initial) onCancel?.();
      else {
        setOpen(false);
        setF({ ...f, rate: '', serviceCode: '', effectiveTo: '' });
      }
      onSaved();
    },
  });
  const close = () => {
    setInvalid(null);
    if (initial) onCancel?.();
    else setOpen(false);
  };
  const submit = () => {
    const b = body();
    const problem = firstIssue(C.commissionRuleInputSchema, b, RULE_LABELS);
    if (problem) return setInvalid(problem);
    setInvalid(null);
    m.mutate(b);
  };
  if (!open)
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus /> Add rule
      </Button>
    );
  return (
    <div className="space-y-3 rounded-md border p-3">
      {initial && <p className="text-sm font-medium">Edit rule</p>}
      <ErrorBox error={invalid ?? (m.error ? errorMessage(m.error) : null)} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="ru-scope" label="Applies to">
          <Select id="ru-scope" value={f.appliesTo} onChange={(e) => setF({ ...f, appliesTo: e.target.value as C.RuleScope })}>
            {C.RULE_SCOPES.map((s) => (
              <option key={s} value={s}>
                {RULE_SCOPE_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="ru-code" label="Service code (optional)">
          <Input id="ru-code" maxLength={40} value={f.serviceCode} onChange={(e) => setF({ ...f, serviceCode: e.target.value.toUpperCase() })} />
        </Field>
        <Field id="ru-type" label="Rate type">
          <Select id="ru-type" value={f.rateType} onChange={(e) => setF({ ...f, rateType: e.target.value as C.RateType })}>
            <option value="percent">% of bill line</option>
            <option value="flat">₹ per item</option>
          </Select>
        </Field>
        <Field id="ru-rate" label={f.rateType === 'percent' ? 'Percent *' : 'Amount (₹) *'}>
          <Input id="ru-rate" type="number" min={0} max={f.rateType === 'percent' ? 100 : undefined} step="0.01" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
        </Field>
        <Field id="ru-from" label="From *">
          <Input id="ru-from" type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} />
        </Field>
        <Field id="ru-to" label="Until (optional)">
          <Input id="ru-to" type="date" min={f.effectiveFrom || undefined} value={f.effectiveTo} onChange={(e) => setF({ ...f, effectiveTo: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.forAll} onChange={(e) => setF({ ...f, forAll: e.target.checked })} /> Hospital default (all referrers)
        </label>
        {initial && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active
          </label>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={close}>
          Cancel
        </Button>
        <Button size="sm" disabled={m.isPending || f.rate === '' || !f.effectiveFrom} onClick={submit}>
          {m.isPending && <Loader2 className="animate-spin" />}
          Save rule
        </Button>
      </div>
    </div>
  );
}

function AddReferral({ referrerId, onSaved }: { referrerId: string; onSaved: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [patient, setPatient] = React.useState<Patient | null>(null);
  const [referredOn, setReferredOn] = React.useState(todayIST());
  const [days, setDays] = React.useState(String(C.DEFAULT_REFERRAL_DAYS));
  const m = useMutation({
    mutationFn: () => {
      const end = days ? new Date(new Date(`${referredOn}T00:00:00Z`).getTime() + Number(days) * 86_400_000).toISOString().slice(0, 10) : null;
      return api.crm.referrals.create({ patientId: patient!.id, referrerId, referredOn, validUntil: end });
    },
    onSuccess: () => {
      setOpen(false);
      setPatient(null);
      onSaved();
    },
  });
  if (!open)
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <UserPlus /> Tag a patient
      </Button>
    );
  return (
    <div className="space-y-3 rounded-md border p-3">
      <ErrorBox error={m.error ? errorMessage(m.error) : null} />
      <PatientPicker value={patient} onChange={setPatient} />
      <div className="grid grid-cols-2 gap-3">
        <Field id="rl-on" label="Referred on">
          <Input id="rl-on" type="date" value={referredOn} onChange={(e) => setReferredOn(e.target.value)} />
        </Field>
        <Field id="rl-days" label="Earns for (days, blank = no end)">
          <Input id="rl-days" type="number" min={0} value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button size="sm" disabled={m.isPending || !patient} onClick={() => m.mutate()}>
          {m.isPending && <Loader2 className="animate-spin" />}
          Save referral
        </Button>
      </div>
    </div>
  );
}
