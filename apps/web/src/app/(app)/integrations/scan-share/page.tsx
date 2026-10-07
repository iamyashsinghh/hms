'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Link2, Loader2, QrCode, RefreshCw, UserPlus } from 'lucide-react';
import type { Patient, integrations as I } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { genderLabel } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  ErrorBox,
  MessageRow,
  Notice,
  PatientName,
  PatientPicker,
  StatusBadge,
  formatAbhaNumber,
  formatDateTime,
  todayIST,
  useAbdmMode,
} from '@/modules/integrations/ui';

type StatusFilter = I.ScanShareStatus | 'all';

export default function ScanSharePage() {
  const canRead = usePermission('integrations.abha.read');
  const canManage = usePermission('integrations.abha.manage');
  const queryClient = useQueryClient();
  const mode = useAbdmMode();
  const [date, setDate] = React.useState(todayIST);
  const [status, setStatus] = React.useState<StatusFilter>('pending');
  const [linking, setLinking] = React.useState<I.ScanShareToken | null>(null);
  const [linkPatient, setLinkPatient] = React.useState<Patient | null>(null);

  const query: I.ScanShareQuery = { date, status };
  const { data, isPending, isFetching, error, dataUpdatedAt } = useQuery({
    queryKey: ['integrations', 'scan-share', query],
    queryFn: () => api.integrations.scanShare.list(query),
    enabled: canRead,
    refetchInterval: 10_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['integrations', 'scan-share'] });
  const resolve = useMutation({
    mutationFn: ({ id, body }: { id: string; body: I.ScanShareResolve }) => api.integrations.scanShare.resolve(id, body),
    onSuccess: () => {
      setLinking(null);
      setLinkPatient(null);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['integrations', 'abha'] });
    },
  });
  const simulate = useMutation({
    mutationFn: () => api.integrations.scanShare.simulate({}),
    onSuccess: () => invalidate(),
  });

  if (!canRead) return <NoAccess />;
  const busy = (id: string) => resolve.isPending && resolve.variables?.id === id;

  return (
    <>
      <PageHeader
        title="Scan & Share queue"
        description="Patients who scanned the hospital's ABDM QR code with their ABHA app. Register them or link them to an existing record. Refreshes every 10 seconds."
        actions={
          canManage && mode === 'mock' ? (
            <Button variant="outline" onClick={() => simulate.mutate()} disabled={simulate.isPending}>
              {simulate.isPending ? <Loader2 className="animate-spin" /> : <QrCode />}
              Simulate scan
            </Button>
          ) : undefined
        }
      />
      {mode === 'disabled' && <Notice tone="warn" className="mb-4">ABDM is disabled in Integration settings, so no new scans will arrive.</Notice>}
      <div className="mb-4 space-y-2">
        <ErrorBox error={simulate.error ? errorMessage(simulate.error) : null} />
        <ErrorBox error={resolve.error && !linking ? errorMessage(resolve.error) : null} />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <Input type="date" className="w-44" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value || todayIST())} />
          <Select className="w-44" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="pending">Waiting</option>
            <option value="registered">Registered</option>
            <option value="linked">Linked</option>
            <option value="dismissed">Dismissed</option>
            <option value="all">All</option>
          </Select>
          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className={`size-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            {dataUpdatedAt ? `Updated ${new Date(dataUpdatedAt).toLocaleTimeString('en-IN')}` : 'Loading'}
          </span>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-20">Token</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Gender</TableHead>
              <TableHead>YOB</TableHead>
              <TableHead>ABHA</TableHead>
              <TableHead>Scanned</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {error ? (
              <MessageRow colSpan={8} error>
                {errorMessage(error)}
              </MessageRow>
            ) : isPending ? (
              <MessageRow colSpan={8}>Loading…</MessageRow>
            ) : data.length === 0 ? (
              <MessageRow colSpan={8}>No tokens for this filter.</MessageRow>
            ) : (
              data.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-lg font-semibold tabular-nums">{t.tokenNo}</TableCell>
                  <TableCell className="font-medium">
                    {t.profile.name}
                    {t.profile.mobile && <span className="block text-xs font-normal text-muted-foreground">{t.profile.mobile}</span>}
                  </TableCell>
                  <TableCell>{genderLabel(t.profile.gender)}</TableCell>
                  <TableCell>{t.profile.yearOfBirth ?? '—'}</TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{formatAbhaNumber(t.profile.abhaNumber)}</span>
                    {t.profile.abhaAddress && <span className="block text-xs text-muted-foreground">{t.profile.abhaAddress}</span>}
                  </TableCell>
                  <TableCell className="text-xs">{formatDateTime(t.createdAt)}</TableCell>
                  <TableCell>
                    <StatusBadge status={t.status} label={t.status === 'pending' ? 'Waiting' : undefined} />
                    {t.patientId && (
                      <span className="block text-xs">
                        <PatientName id={t.patientId} />
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage && t.status === 'pending' && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" disabled={busy(t.id)} onClick={() => resolve.mutate({ id: t.id, body: { action: 'register' } })}>
                          {busy(t.id) && resolve.variables?.body.action === 'register' ? <Loader2 className="animate-spin" /> : <UserPlus />}
                          Register new
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy(t.id)} onClick={() => setLinking(t)}>
                          <Link2 /> Link existing
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy(t.id)} onClick={() => resolve.mutate({ id: t.id, body: { action: 'dismiss' } })} aria-label="Dismiss">
                          <Ban /> Dismiss
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog
        open={!!linking}
        onClose={() => {
          setLinking(null);
          setLinkPatient(null);
          resolve.reset();
        }}
        title={linking ? `Link token ${linking.tokenNo} to a patient` : 'Link'}
      >
        {linking && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (linkPatient) resolve.mutate({ id: linking.id, body: { action: 'link', patientId: linkPatient.id } });
            }}
          >
            <p className="text-sm">
              <span className="font-medium">{linking.profile.name}</span> · {genderLabel(linking.profile.gender)}
              {linking.profile.yearOfBirth ? ` · born ${linking.profile.yearOfBirth}` : ''} · ABHA{' '}
              <span className="font-mono">{formatAbhaNumber(linking.profile.abhaNumber)}</span>
            </p>
            <PatientPicker value={linkPatient} onChange={setLinkPatient} label="Existing patient" id="link-patient" />
            <ErrorBox error={resolve.error ? errorMessage(resolve.error) : null} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setLinking(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!linkPatient || resolve.isPending}>
                {resolve.isPending && <Loader2 className="animate-spin" />}
                Link
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
