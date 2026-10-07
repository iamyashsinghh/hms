'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Loader2 } from 'lucide-react';
import type { Patient } from '@hms/shared';
import { api } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { ageOf, formatDate, fullName, genderLabel } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorBox, PatientPicker } from '@/modules/frontoffice/ui';

function Facts({ p }: { p: Patient }) {
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Name</dt>
      <dd>{fullName(p)}</dd>
      <dt className="text-muted-foreground">UHID</dt>
      <dd className="font-mono">{p.uhid}</dd>
      <dt className="text-muted-foreground">Gender / age</dt>
      <dd>
        {genderLabel(p.gender)} · {ageOf(p)}
      </dd>
      <dt className="text-muted-foreground">Mobile</dt>
      <dd>{p.mobile ?? '—'}</dd>
      <dt className="text-muted-foreground">ABHA</dt>
      <dd>{p.abhaNumber ?? '—'}</dd>
      <dt className="text-muted-foreground">Registered</dt>
      <dd>{formatDate(p.createdAt)}</dd>
    </dl>
  );
}

export default function MergePage() {
  const canMerge = usePermission('frontoffice.patient.merge');
  const queryClient = useQueryClient();
  const [source, setSource] = React.useState<Patient | null>(null);
  const [target, setTarget] = React.useState<Patient | null>(null);
  const [reason, setReason] = React.useState('');

  const merges = useQuery({ queryKey: ['frontoffice', 'merges'], queryFn: () => api.frontoffice.patients.merges(), enabled: canMerge });
  const merge = useMutation({
    mutationFn: () => api.frontoffice.patients.merge({ sourcePatientId: source!.id, targetPatientId: target!.id, reason }),
    onSuccess: () => {
      setSource(null);
      setTarget(null);
      setReason('');
      queryClient.invalidateQueries({ queryKey: ['frontoffice'] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });

  if (!canMerge) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Merge duplicate patients"
        description="The duplicate is deactivated and its appointments and visits move to the record you keep. This cannot be undone from the screen."
      />
      <div className="grid items-start gap-4 md:grid-cols-[1fr_auto_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Duplicate (will be retired)</CardTitle>
          </CardHeader>
          <CardContent>
            <PatientPicker value={source} onChange={setSource} />
            {source && <Facts p={source} />}
          </CardContent>
        </Card>
        <ArrowRight className="mx-auto mt-16 hidden size-6 text-muted-foreground md:block" />
        <Card>
          <CardHeader>
            <CardTitle>Record to keep</CardTitle>
          </CardHeader>
          <CardContent>
            <PatientPicker value={target} onChange={setTarget} />
            {target && <Facts p={target} />}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="min-w-64 flex-1">
            <Label htmlFor="reason">Reason</Label>
            <Input id="reason" className="mt-1" placeholder="e.g. Same person registered twice at the desk" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button
            variant="destructive"
            disabled={!source || !target || source.id === target.id || reason.trim().length < 3 || merge.isPending}
            onClick={() => {
              if (window.confirm(`Merge ${source!.uhid} into ${target!.uhid}?`)) merge.mutate();
            }}
          >
            {merge.isPending && <Loader2 className="animate-spin" />}
            Merge records
          </Button>
          <div className="w-full">
            <ErrorBox error={merge.error} />
            {merge.isSuccess && (
              <p className="text-sm text-primary">
                Merged. Moved {merge.data.movedAppointments} appointments and {merge.data.movedVisits} visits.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent merges</CardTitle>
          <CardDescription>Every merge keeps a snapshot of the retired record for audit.</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>When</TableHead>
              <TableHead>Retired record</TableHead>
              <TableHead>Kept record</TableHead>
              <TableHead>Moved</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(merges.data ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No merges yet.
                </TableCell>
              </TableRow>
            ) : (
              merges.data!.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{formatDate(m.mergedAt)}</TableCell>
                  <TableCell className="font-mono text-xs">{m.sourcePatientId.slice(0, 8)}</TableCell>
                  <TableCell className="font-mono text-xs">{m.targetPatientId.slice(0, 8)}</TableCell>
                  <TableCell>
                    {m.movedAppointments} appts · {m.movedVisits} visits
                  </TableCell>
                  <TableCell>{m.reason}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
