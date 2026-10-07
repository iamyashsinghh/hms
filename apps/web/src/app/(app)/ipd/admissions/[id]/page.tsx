'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import type { ipd as I } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { formatDate, genderLabel } from '@/lib/format';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { BillTab } from '@/modules/ipd/billing';
import { IntakeOutputTab, MedicationsTab, NotesTab, RoundsTab, VitalsTab } from '@/modules/ipd/chart';
import { DischargeTab } from '@/modules/ipd/discharge';
import { ADMISSION_TYPE_LABELS, AdmissionStatusBadge, ErrorBox, Field, daysLabel, formatDateTime, formatINR } from '@/modules/ipd/ui';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'rounds', label: 'Rounds' },
  { key: 'vitals', label: 'Vitals' },
  { key: 'meds', label: 'Medications' },
  { key: 'notes', label: 'Nursing notes' },
  { key: 'io', label: 'Intake / output' },
  { key: 'bill', label: 'Bill', permission: 'ipd.charge.read' },
  { key: 'discharge', label: 'Discharge' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export default function AdmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('ipd.admission.read');
  const canBill = usePermission('ipd.charge.read');
  const [tab, setTab] = React.useState<TabKey>('overview');
  const { data: a, error } = useQuery({ queryKey: ['ipd', 'admission', id], queryFn: () => api.ipd.admissions.get(id), enabled: canRead });

  if (!canRead) return <NoAccess />;
  if (error) return <ErrorBox error={errorMessage(error)} />;
  if (!a) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const active = a.status === 'admitted';
  const tabs = TABS.filter((t) => !('permission' in t) || (t.permission === 'ipd.charge.read' && canBill));

  return (
    <>
      <Link href="/ipd/admissions" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> Admissions
      </Link>
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {a.patientName}
            <AdmissionStatusBadge status={a.status} />
            {a.isMlc && (
              <span className="inline-flex items-center gap-1 text-sm font-medium text-destructive">
                <ShieldAlert className="size-4" /> MLC {a.mlcNo ?? ''}
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-mono">{a.ipdNo}</span> · UHID <span className="font-mono">{a.patientUhid}</span>
            {a.patientGender && ` · ${genderLabel(a.patientGender)}`} · Dr. {a.doctorName.replace(/^Dr\.?\s*/i, '')} · {daysLabel(a.lengthOfStay)}
          </p>
        </div>
        <div className="text-sm sm:text-right">
          <p className="font-medium">{a.bedLabel ? `${a.wardName} · Bed ${a.bedLabel}` : 'No bed'}</p>
          <p className="text-muted-foreground">Admitted {formatDateTime(a.admittedAt)}</p>
        </div>
      </div>

      <div role="tablist" className="mb-6 flex gap-1 overflow-x-auto border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
              tab === t.key ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview a={a} />}
      {tab === 'rounds' && <RoundsTab admissionId={id} active={active} />}
      {tab === 'vitals' && <VitalsTab admissionId={id} active={active} />}
      {tab === 'meds' && <MedicationsTab admissionId={id} active={active} />}
      {tab === 'notes' && <NotesTab admissionId={id} active={active} />}
      {tab === 'io' && <IntakeOutputTab admissionId={id} active={active} />}
      {tab === 'bill' && <BillTab admission={a} />}
      {tab === 'discharge' && <DischargeTab admission={a} />}
    </>
  );
}

function Overview({ a }: { a: I.Admission }) {
  const canTransfer = usePermission('ipd.admission.transfer');
  const canCancel = usePermission('ipd.admission.cancel');
  const active = a.status === 'admitted';
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Admission</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Item label="Type" value={ADMISSION_TYPE_LABELS[a.admissionType]} />
              <Item label="Expected discharge" value={a.expectedDischargeDate ? formatDate(a.expectedDischargeDate) : '—'} />
              <Item label="Reason" value={a.reason} wide />
              <Item label="Provisional diagnosis" value={a.provisionalDiagnosis ?? '—'} wide />
              <Item label="Attendant" value={a.attendantName ? `${a.attendantName}${a.attendantRelation ? ` (${a.attendantRelation})` : ''}` : '—'} />
              <Item label="Attendant mobile" value={a.attendantMobile ?? '—'} />
              <Item label="Patient mobile" value={a.patientMobile ?? '—'} />
              <Item label="Date of birth" value={a.patientDob ? formatDate(a.patientDob) : '—'} />
              {a.cancelReason && <Item label="Cancelled because" value={a.cancelReason} wide />}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Bed history</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {a.stays.map((s) => (
                <li key={s.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:justify-between">
                  <span>
                    <span className="font-medium">{s.bedLabel}</span> · {formatINR(s.dailyRate)}/day{s.reason ? ` · ${s.reason}` : ''}
                  </span>
                  <span className="text-muted-foreground">
                    {formatDateTime(s.fromAt)} → {s.toAt ? formatDateTime(s.toAt) : 'now'}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
      <div className="space-y-6">
        {active && canTransfer && !a.invoiceId && <TransferCard a={a} />}
        {active && canCancel && !a.invoiceId && <CancelCard a={a} />}
      </div>
    </div>
  );
}

function Item({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap">{value}</dd>
    </div>
  );
}

function TransferCard({ a }: { a: I.Admission }) {
  const queryClient = useQueryClient();
  const [bedId, setBedId] = React.useState('');
  const [reason, setReason] = React.useState('');
  const { data: board } = useQuery({ queryKey: ['ipd', 'bed-board'], queryFn: () => api.ipd.bedBoard() });
  const transfer = useMutation({
    mutationFn: (body: I.TransferInput) => api.ipd.admissions.transfer(a.id, body),
    onSuccess: () => {
      setBedId('');
      setReason('');
      queryClient.invalidateQueries({ queryKey: ['ipd'] });
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Transfer bed</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Select aria-label="New bed" value={bedId} onChange={(e) => setBedId(e.target.value)}>
          <option value="">Choose a free bed…</option>
          {board?.wards.map((w) => {
            const free = w.beds.filter((b) => b.status === 'available' || b.status === 'reserved');
            if (!free.length) return null;
            return (
              <optgroup key={w.id} label={w.name}>
                {free.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} · {formatINR(b.dailyRate)}/day
                  </option>
                ))}
              </optgroup>
            );
          })}
        </Select>
        <Field id="t-reason" label="Reason">
          <Input id="t-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Shifted to ICU, patient request…" />
        </Field>
        <ErrorBox error={transfer.error ? errorMessage(transfer.error) : null} />
        <Button disabled={!bedId || reason.trim().length < 2 || transfer.isPending} onClick={() => transfer.mutate({ bedId, reason })}>
          Transfer
        </Button>
      </CardContent>
    </Card>
  );
}

function CancelCard({ a }: { a: I.Admission }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = React.useState('');
  const cancel = useMutation({
    mutationFn: () => api.ipd.admissions.cancel(a.id, { reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ipd'] }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cancel admission</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm text-muted-foreground">Only for an admission made by mistake. It frees the bed. Not possible once an advance is taken.</p>
        <Input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" maxLength={500} />
        <ErrorBox error={cancel.error ? errorMessage(cancel.error) : null} />
        <Button
          variant="destructive"
          disabled={reason.trim().length < 3 || cancel.isPending}
          onClick={() => window.confirm('Cancel this admission?') && cancel.mutate()}
        >
          Cancel admission
        </Button>
      </CardContent>
    </Card>
  );
}
