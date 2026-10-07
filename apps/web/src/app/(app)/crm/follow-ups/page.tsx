'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Check, Loader2, Plus, Send, X } from 'lucide-react';
import { crm as C, type Patient } from '@hms/shared';
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
import { cn } from '@/lib/utils';
import {
  ErrorBox,
  FOLLOW_UP_SOURCE_LABELS,
  FOLLOW_UP_TYPE_LABELS,
  Field,
  Pager,
  PatientPicker,
  Select,
  addDaysISO,
  formatDateTime,
  todayIST,
} from '@/modules/crm/ui';

type Tab = 'overdue' | 'today' | 'upcoming' | 'done';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'done', label: 'Closed' },
];

export default function FollowUpsPage() {
  return (
    <React.Suspense>
      <FollowUps />
    </React.Suspense>
  );
}

function FollowUps() {
  const canRead = usePermission('crm.followup.read');
  const canManage = usePermission('crm.followup.manage');
  const params = useSearchParams();
  const patientId = params.get('patientId') ?? undefined;
  const queryClient = useQueryClient();
  const [tab, setTab] = React.useState<Tab>((params.get('when') as Tab) ?? 'today');
  const [page, setPage] = React.useState(1);
  const [adding, setAdding] = React.useState(false);
  const [closing, setClosing] = React.useState<C.FollowUp | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const query: C.FollowUpQuery =
    tab === 'done' ? { status: 'done', patientId, page, pageSize: 25 } : patientId ? { status: 'pending', patientId, page } : { when: tab, page, pageSize: 25 };
  const { data, isPending, error } = useQuery({
    queryKey: ['crm', 'follow-ups', query],
    queryFn: () => api.crm.followUps.list(query),
    placeholderData: keepPreviousData,
    enabled: canRead,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['crm'] });

  const remind = useMutation({
    mutationFn: (id: string) => api.crm.followUps.remind(id),
    onSuccess: (r) => {
      setNotice(r.queued ? `Reminder queued for ${r.patientName ?? r.leadName}.` : `Not sent: ${r.reason ?? 'no mobile number'}.`);
      refresh();
    },
    onError: (e) => setNotice(errorMessage(e)),
  });
  const remindDue = useMutation({
    mutationFn: () => api.crm.followUps.remindDue(),
    onSuccess: (r) => {
      setNotice(`Reminders for ${formatDate(r.date)}: ${r.reminded} sent, ${r.skipped} could not be sent.`);
      refresh();
    },
    onError: (e) => setNotice(errorMessage(e)),
  });

  if (!canRead) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Follow-ups"
        description="Revisits the doctor advised, recovery calls after a low rating, and reminders you add. Reminders for tomorrow go out automatically each morning."
        actions={
          <Can permission="crm.followup.manage">
            <Button variant="outline" disabled={remindDue.isPending} onClick={() => remindDue.mutate()}>
              {remindDue.isPending ? <Loader2 className="animate-spin" /> : <Send />} Remind tomorrow&apos;s now
            </Button>
            <Button onClick={() => setAdding(true)}>
              <Plus /> New follow-up
            </Button>
          </Can>
        }
      />
      {notice && (
        <div className="mb-4 flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
          {notice}
          <Button variant="ghost" size="sm" onClick={() => setNotice(null)} aria-label="Dismiss">
            <X />
          </Button>
        </div>
      )}
      {adding && canManage && (
        <NewFollowUp
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}
      {closing && (
        <CloseFollowUp
          f={closing}
          onClose={() => setClosing(null)}
          onSaved={() => {
            setClosing(null);
            refresh();
          }}
        />
      )}

      <Card>
        {patientId ? (
          <div className="flex items-center justify-between border-b px-4 py-3 text-sm">
            <span>Showing one patient&apos;s {tab === 'done' ? 'closed' : 'pending'} follow-ups.</span>
            <Link href="/crm/follow-ups" className="text-primary hover:underline">
              Show all
            </Link>
          </div>
        ) : (
          <div className="flex gap-1 border-b p-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setTab(t.key);
                  setPage(1);
                }}
                className={cn('rounded-md px-3 py-1.5 text-sm', tab === t.key ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted')}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        {error ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Due</TableHead>
                <TableHead>Patient / enquiry</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Reminded</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Nothing here.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>{f.status === 'pending' && f.dueDate < todayIST() ? <Badge variant="destructive">{formatDate(f.dueDate)}</Badge> : formatDate(f.dueDate)}</TableCell>
                    <TableCell>
                      {f.patientId ? (
                        <Link href={`/patients/${f.patientId}`} className="font-medium text-primary hover:underline">
                          {f.patientName}
                        </Link>
                      ) : (
                        <Link href={`/crm/leads/${f.leadId}`} className="font-medium text-primary hover:underline">
                          {f.leadName}
                        </Link>
                      )}
                      <div className="text-xs text-muted-foreground">{f.patientUhid ?? 'Enquiry'}{f.patientMobile && ` · ${f.patientMobile}`}</div>
                    </TableCell>
                    <TableCell>{FOLLOW_UP_TYPE_LABELS[f.type]}</TableCell>
                    <TableCell className="max-w-64">
                      <span className="line-clamp-2">{f.reason ?? '—'}</span>
                      {f.outcome && <div className="text-xs text-muted-foreground">Outcome: {f.outcome}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{FOLLOW_UP_SOURCE_LABELS[f.source]}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{f.reminderCount ? `${f.reminderCount}× · ${formatDateTime(f.lastRemindedAt)}` : '—'}</TableCell>
                    <TableCell className="text-right">
                      {f.status === 'pending' && canManage && (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" disabled={remind.isPending} onClick={() => remind.mutate(f.id)}>
                            <BellRing /> Remind
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setClosing(f)}>
                            <Check /> Close
                          </Button>
                        </div>
                      )}
                      {f.status !== 'pending' && <Badge variant={f.status === 'done' ? 'accent' : 'secondary'}>{f.status}</Badge>}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
        <Pager data={data} page={page} setPage={setPage} />
      </Card>
    </>
  );
}

function NewFollowUp({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [patient, setPatient] = React.useState<Patient | null>(null);
  const [dueDate, setDueDate] = React.useState(addDaysISO(todayIST(), 7));
  const [type, setType] = React.useState<C.FollowUpType>('revisit');
  const [reason, setReason] = React.useState('');
  const m = useMutation({
    mutationFn: () => api.crm.followUps.create({ patientId: patient!.id, dueDate, type, reason: reason || null }),
    onSuccess: onSaved,
  });
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>New follow-up</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ErrorBox error={m.error ? errorMessage(m.error) : null} />
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <PatientPicker value={patient} onChange={setPatient} />
          </div>
          <Field id="fu-due" label="Due on *">
            <Input id="fu-due" type="date" min={todayIST()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field id="fu-type" label="Type">
            <Select id="fu-type" value={type} onChange={(e) => setType(e.target.value as C.FollowUpType)}>
              {C.FOLLOW_UP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {FOLLOW_UP_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="fu-reason" label="Reason" className="sm:col-span-4">
            <Input id="fu-reason" placeholder="e.g. Review BP after medicine change" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={m.isPending || !patient || !dueDate} onClick={() => m.mutate()}>
            {m.isPending && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CloseFollowUp({ f, onClose, onSaved }: { f: C.FollowUp; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = React.useState<'done' | 'cancelled'>('done');
  const [outcome, setOutcome] = React.useState('');
  const m = useMutation({ mutationFn: () => api.crm.followUps.close(f.id, { status, outcome: outcome || null }), onSuccess: onSaved });
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Close follow-up for {f.patientName ?? f.leadName}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ErrorBox error={m.error ? errorMessage(m.error) : null} />
        <div className="grid gap-4 sm:grid-cols-4">
          <Field id="cl-status" label="Result">
            <Select id="cl-status" value={status} onChange={(e) => setStatus(e.target.value as 'done' | 'cancelled')}>
              <option value="done">Done</option>
              <option value="cancelled">Not needed</option>
            </Select>
          </Field>
          <Field id="cl-outcome" label="Outcome" className="sm:col-span-3">
            <Input id="cl-outcome" placeholder="e.g. Booked for Monday 10 AM" value={outcome} onChange={(e) => setOutcome(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={m.isPending} onClick={() => m.mutate()}>
            {m.isPending && <Loader2 className="animate-spin" />}
            Close follow-up
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
