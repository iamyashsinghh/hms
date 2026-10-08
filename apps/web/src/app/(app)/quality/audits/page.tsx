'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Loader2, Plus } from 'lucide-react';
import { quality as Q } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/validate';
import { Can, usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EnumSelect, ErrorBox, Field, Pager, StatusBadge, humanize, todayIST } from '@/modules/quality/ui';

export default function AuditsPage() {
  const can = usePermission('quality.audit.read');
  const canConduct = usePermission('quality.audit.conduct');
  const router = useRouter();
  const [status, setStatus] = React.useState<Q.AuditStatus | ''>('');
  const [category, setCategory] = React.useState<Q.ChecklistCategory | ''>('');
  const [page, setPage] = React.useState(1);
  const [scheduling, setScheduling] = React.useState(false);
  const query = { status: status || undefined, category: category || undefined, page, pageSize: 25 };
  const { data, isPending, error } = useQuery({
    queryKey: ['quality', 'audits', query],
    queryFn: () => api.quality.audits.list(query),
    placeholderData: keepPreviousData,
    enabled: can,
  });
  if (!can) return <NoAccess />;
  return (
    <>
      <PageHeader
        title="Audits"
        description="Hand hygiene, documentation, medication safety and other audits against checklists. Score = Yes ÷ (Yes + No)."
        actions={
          <>
            <Link href="/quality/audits/checklists" className={buttonVariants({ variant: 'outline' })}>
              <ListChecks /> Checklists
            </Link>
            {canConduct && (
              <Button onClick={() => setScheduling(true)}>
                <Plus /> Schedule audit
              </Button>
            )}
          </>
        }
      />
      <div className="space-y-6">
        {scheduling && <Schedule onDone={(id) => (id ? router.push(`/quality/audits/${id}`) : setScheduling(false))} />}
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b p-4">
            <div className="w-40">
              <EnumSelect value={status} onChange={(v) => (setStatus(v), setPage(1))} options={Q.AUDIT_STATUSES} placeholder="Any status" />
            </div>
            <div className="w-52">
              <EnumSelect value={category} onChange={(v) => (setCategory(v), setPage(1))} options={Q.CHECKLIST_CATEGORIES} placeholder="Any category" />
            </div>
          </div>
          {error && <p className="px-4 pt-3 text-sm text-destructive">{errorMessage(error)}</p>}
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>No.</TableHead>
                <TableHead>Checklist</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead>Auditor</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : !data?.items.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No audits yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((a) => (
                  <TableRow key={a.id} className="cursor-pointer" onClick={() => router.push(`/quality/audits/${a.id}`)}>
                    <TableCell className="font-mono text-xs">{a.auditNo}</TableCell>
                    <TableCell>
                      {a.checklistName}
                      <div className="text-xs text-muted-foreground">{humanize(a.category)}</div>
                    </TableCell>
                    <TableCell>{a.department ?? '—'}</TableCell>
                    <TableCell>{a.scheduledOn}</TableCell>
                    <TableCell>{a.auditor?.name ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.score == null ? '—' : `${a.score.toFixed(1)}%`}</TableCell>
                    <TableCell>
                      <StatusBadge status={a.status} overdue={a.status === 'scheduled' && a.scheduledOn < todayIST()} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <Pager data={data} page={page} setPage={setPage} />
        </Card>
      </div>
    </>
  );
}

function Schedule({ onDone }: { onDone: (id?: string) => void }) {
  const queryClient = useQueryClient();
  const { data: checklists } = useQuery({ queryKey: ['quality', 'checklists', false], queryFn: () => api.quality.checklists.list() });
  const [checklistId, setChecklistId] = React.useState('');
  const [scheduledOn, setScheduledOn] = React.useState(todayIST());
  const [department, setDepartment] = React.useState('');
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const create = useMutation({
    mutationFn: (body: Q.ScheduleAudit) => api.quality.audits.schedule(body),
    onSuccess: (a) => {
      queryClient.invalidateQueries({ queryKey: ['quality'] });
      onDone(a.id);
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Schedule an audit</CardTitle>
      </CardHeader>
      <CardContent>
        {checklists && checklists.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No checklists yet.{' '}
            <Can permission="quality.checklist.manage">
              <Link href="/quality/audits/checklists" className="text-primary hover:underline">
                Create one first.
              </Link>
            </Can>
          </p>
        ) : (
          <form
            className="grid gap-4 sm:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              const body: Q.ScheduleAudit = { checklistId, scheduledOn, department: department || undefined };
              const { errors: found } = validate(Q.scheduleAuditSchema, body);
              setErrors(found ?? {});
              if (!found) create.mutate(body);
            }}
          >
            <div className="sm:col-span-4">
              <ErrorBox error={Object.keys(errors).length ? 'Please correct the highlighted fields' : create.error} />
            </div>
            <Field id="a-checklist" label="Checklist *" className="sm:col-span-2">
              <Select id="a-checklist" required value={checklistId} onChange={(e) => setChecklistId(e.target.value)}>
                <option value="">Choose…</option>
                {checklists?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.items.length} items)
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="a-date" label="Date *" error={errors.scheduledOn}>
              <Input id="a-date" type="date" required min={todayIST()} value={scheduledOn} onChange={(e) => setScheduledOn(e.target.value)} />
            </Field>
            <Field id="a-dept" label="Department / ward">
              <Input id="a-dept" maxLength={120} value={department} onChange={(e) => setDepartment(e.target.value)} />
            </Field>
            <div className="flex gap-2 sm:col-span-4">
              <Button type="submit" disabled={create.isPending || !checklistId}>
                {create.isPending && <Loader2 className="animate-spin" />} Schedule
              </Button>
              <Button type="button" variant="ghost" onClick={() => onDone()}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
