'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, PhoneCall, UserCheck, XCircle } from 'lucide-react';
import type { Patient, crm as C } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  ErrorBox,
  Field,
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_LABELS,
  LeadStatusBadge,
  PatientPicker,
  Select,
  Textarea,
  formatDateTime,
  fromLocalInput,
  toLocalInput,
} from '@/modules/crm/ui';

const OPEN = ['new', 'contacted', 'qualified'];

const ACTIVITY_LABELS: Record<C.ActivityType, string> = {
  note: 'Note',
  call: 'Call',
  message: 'Message',
  visit: 'Visit',
  status_change: 'Status',
};

export default function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('crm.lead.read');
  const canManage = usePermission('crm.lead.manage');
  const canFollowUp = usePermission('crm.followup.manage');
  const queryClient = useQueryClient();
  const { data: lead, error } = useQuery({ queryKey: ['crm', 'lead', id], queryFn: () => api.crm.leads.get(id), enabled: canRead });

  const done = (l: C.LeadDetail) => {
    queryClient.setQueryData(['crm', 'lead', id], l);
    queryClient.invalidateQueries({ queryKey: ['crm', 'leads'] });
    queryClient.invalidateQueries({ queryKey: ['crm', 'dashboard'] });
  };

  if (!canRead) return <NoAccess />;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  if (!lead) return <Loader2 className="mx-auto mt-10 size-6 animate-spin text-muted-foreground" />;

  const open = OPEN.includes(lead.status);

  return (
    <>
      <Link href="/crm/leads" className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'mb-2 -ml-2' })}>
        <ArrowLeft /> Enquiries
      </Link>
      <PageHeader
        title={lead.name}
        description={
          <>
            <span className="font-mono">{lead.number}</span> · {LEAD_SOURCE_LABELS[lead.source]}
            {lead.campName && ` · ${lead.campName}`}
            {lead.referrerName && ` · referred by ${lead.referrerName}`}
          </>
        }
        actions={<LeadStatusBadge status={lead.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {open && canManage && <LogActivity lead={lead} onDone={done} />}
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              {lead.activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing logged yet.</p>
              ) : (
                <ol className="space-y-3">
                  {lead.activities.map((a) => (
                    <li key={a.id} className="border-l-2 pl-3">
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(a.createdAt)} · {ACTIVITY_LABELS[a.type]}
                        {a.createdByName && ` · ${a.createdByName}`}
                      </p>
                      {a.type === 'status_change' ? (
                        <p className="text-sm">
                          {a.fromStatus ? LEAD_STATUS_LABELS[a.fromStatus] : '—'} → <strong>{a.toStatus ? LEAD_STATUS_LABELS[a.toStatus] : '—'}</strong>
                          {a.note && <span className="text-muted-foreground"> ({a.note})</span>}
                        </p>
                      ) : (
                        <p className="whitespace-pre-wrap text-sm">{a.note}</p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Mobile">{lead.mobile ?? '—'}</Row>
              <Row label="Email">{lead.email ?? '—'}</Row>
              <Row label="Gender / age">{[lead.gender, lead.ageYears != null ? `${lead.ageYears} y` : null].filter(Boolean).join(' · ') || '—'}</Row>
              <Row label="City">{lead.city ?? '—'}</Row>
              <Row label="Looking for">{lead.interest ?? '—'}</Row>
              <Row label="Next call">{formatDateTime(lead.nextFollowUpAt)}</Row>
              <Row label="Assigned to">{lead.assignedToName ?? '—'}</Row>
              {lead.notes && <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-2">{lead.notes}</p>}
              {lead.lostReason && <Row label="Lost because">{lead.lostReason}</Row>}
              {lead.patientId && (
                <Link href={`/patients/${lead.patientId}`} className={buttonVariants({ variant: 'outline', size: 'sm', className: 'mt-2 w-full' })}>
                  Open patient record
                </Link>
              )}
            </CardContent>
          </Card>
          {open && canManage && <Convert lead={lead} onDone={done} />}
          {open && canManage && <Lose lead={lead} onDone={done} />}
          {lead.status === 'lost' && canManage && <Reopen id={lead.id} onDone={done} />}
          {canFollowUp && lead.patientId && (
            <Link href={`/crm/follow-ups?patientId=${lead.patientId}`} className={buttonVariants({ variant: 'outline', className: 'w-full' })}>
              Patient follow-ups
            </Link>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function LogActivity({ lead, onDone }: { lead: C.LeadDetail; onDone: (l: C.LeadDetail) => void }) {
  const [type, setType] = React.useState<'call' | 'note' | 'message' | 'visit'>('call');
  const [note, setNote] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [next, setNext] = React.useState(toLocalInput(lead.nextFollowUpAt));
  const m = useMutation({
    mutationFn: () =>
      api.crm.leads.addActivity(lead.id, {
        type,
        note,
        status: (status || undefined) as C.LeadActivityInput['status'],
        nextFollowUpAt: fromLocalInput(next),
      }),
    onSuccess: (l) => {
      setNote('');
      setStatus('');
      onDone(l);
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PhoneCall className="size-4" /> Log contact
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ErrorBox error={m.error ? errorMessage(m.error) : null} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="act-type" label="Type">
            <Select id="act-type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="call">Call</option>
              <option value="message">Message</option>
              <option value="visit">Visit</option>
              <option value="note">Note</option>
            </Select>
          </Field>
          <Field id="act-status" label="Move to">
            <Select id="act-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">(keep {LEAD_STATUS_LABELS[lead.status]})</option>
              <option value="contacted">Contacted</option>
              <option value="qualified">Interested</option>
            </Select>
          </Field>
          <Field id="act-next" label="Next call">
            <Input id="act-next" type="datetime-local" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field id="act-note" label="What was discussed *" className="sm:col-span-3">
            <Textarea id="act-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button disabled={m.isPending || !note.trim()} onClick={() => m.mutate()}>
            {m.isPending && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Convert({ lead, onDone }: { lead: C.LeadDetail; onDone: (l: C.LeadDetail) => void }) {
  const [mode, setMode] = React.useState<'new' | 'existing'>('new');
  const [patient, setPatient] = React.useState<Patient | null>(null);
  const [first, ...rest] = lead.name.split(' ');
  const [reg, setReg] = React.useState({ firstName: first ?? '', lastName: rest.join(' '), gender: lead.gender ?? '', ageYears: lead.ageYears?.toString() ?? '' });
  const m = useMutation({
    mutationFn: () =>
      api.crm.leads.convert(
        lead.id,
        mode === 'existing'
          ? { patientId: patient!.id }
          : {
              register: {
                firstName: reg.firstName,
                lastName: reg.lastName || undefined,
                gender: reg.gender as 'male' | 'female' | 'other',
                ageYears: reg.ageYears ? Number(reg.ageYears) : undefined,
                mobile: lead.mobile ?? undefined,
              },
            },
      ),
    onSuccess: onDone,
  });
  const ready = mode === 'existing' ? !!patient : !!reg.firstName.trim() && !!reg.gender;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCheck className="size-4" /> Convert to patient
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ErrorBox error={m.error ? errorMessage(m.error) : null} />
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> Register new
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} /> Existing patient
          </label>
        </div>
        {mode === 'existing' ? (
          <PatientPicker value={patient} onChange={setPatient} />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field id="cv-first" label="First name *">
              <Input id="cv-first" value={reg.firstName} onChange={(e) => setReg({ ...reg, firstName: e.target.value })} />
            </Field>
            <Field id="cv-last" label="Last name">
              <Input id="cv-last" value={reg.lastName} onChange={(e) => setReg({ ...reg, lastName: e.target.value })} />
            </Field>
            <Field id="cv-gender" label="Gender *">
              <Select id="cv-gender" value={reg.gender} onChange={(e) => setReg({ ...reg, gender: e.target.value })}>
                <option value="">—</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            <Field id="cv-age" label="Age">
              <Input id="cv-age" type="number" min={0} max={130} value={reg.ageYears} onChange={(e) => setReg({ ...reg, ageYears: e.target.value })} />
            </Field>
          </div>
        )}
        {lead.referrerName && <p className="text-xs text-muted-foreground">The referral to {lead.referrerName} starts automatically.</p>}
        <Button className="w-full" disabled={m.isPending || !ready} onClick={() => m.mutate()}>
          {m.isPending && <Loader2 className="animate-spin" />}
          Convert
        </Button>
      </CardContent>
    </Card>
  );
}

function Lose({ lead, onDone }: { lead: C.LeadDetail; onDone: (l: C.LeadDetail) => void }) {
  const [reason, setReason] = React.useState('');
  const m = useMutation({ mutationFn: () => api.crm.leads.lose(lead.id, { reason }), onSuccess: onDone });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <XCircle className="size-4" /> Close as lost
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ErrorBox error={m.error ? errorMessage(m.error) : null} />
        <Input aria-label="Reason" placeholder="Reason (e.g. price, went elsewhere)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button variant="outline" className="w-full" disabled={m.isPending || !reason.trim()} onClick={() => m.mutate()}>
          Mark lost
        </Button>
      </CardContent>
    </Card>
  );
}

function Reopen({ id, onDone }: { id: string; onDone: (l: C.LeadDetail) => void }) {
  const m = useMutation({ mutationFn: () => api.crm.leads.reopen(id), onSuccess: onDone });
  return (
    <Button variant="outline" className="w-full" disabled={m.isPending} onClick={() => m.mutate()}>
      Reopen enquiry
    </Button>
  );
}
