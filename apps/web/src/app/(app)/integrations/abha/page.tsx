'use client';

import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Loader2, RotateCw, Unlink } from 'lucide-react';
import { integrations as I, type Patient } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { firstError, validate } from '@/lib/validate';
import { formatDate, genderLabel } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  ErrorBox,
  Field,
  MessageRow,
  Notice,
  Pager,
  PatientName,
  PatientPicker,
  StatusBadge,
  formatAbhaNumber,
  formatDateTime,
  useAbdmMode,
} from '@/modules/integrations/ui';

const PAGE_SIZE = 25;

const METHOD_LABELS: Record<I.AbhaOtpMethod, string> = {
  aadhaar: 'Aadhaar OTP',
  mobile: 'Mobile OTP',
  abha: 'ABHA number / address',
};
const IDENTIFIER_HINT: Record<I.AbhaOtpMethod, { label: string; placeholder: string }> = {
  aadhaar: { label: 'Aadhaar number', placeholder: '12 digits (never stored)' },
  mobile: { label: 'Mobile number', placeholder: '10-digit mobile' },
  abha: { label: 'ABHA number or address', placeholder: '14-digit number or name@abdm' },
};

function AbhaFlow() {
  const queryClient = useQueryClient();
  const mode = useAbdmMode();
  const [patient, setPatient] = React.useState<Patient | null>(null);
  const [purpose, setPurpose] = React.useState<I.AbhaPurpose>('verify');
  const [method, setMethod] = React.useState<I.AbhaOtpMethod>('mobile');
  const [identifier, setIdentifier] = React.useState('');
  const [otp, setOtp] = React.useState('');
  const [request, setRequest] = React.useState<I.AbhaRequest | null>(null);
  const [linked, setLinked] = React.useState<I.AbhaLink | null>(null);

  const [idError, setIdError] = React.useState<string | null>(null);
  const requestOtp = useMutation({
    mutationFn: () => api.integrations.abha.requestOtp({ purpose, method, identifier: identifier.trim(), patientId: patient?.id }),
    onSuccess: (r) => {
      setRequest(r);
      setOtp('');
    },
  });
  const verifyOtp = useMutation({
    mutationFn: () => api.integrations.abha.verifyOtp({ requestId: request!.id, otp: otp.trim() }),
    onSuccess: (r) => setRequest(r),
  });
  const link = useMutation({
    mutationFn: () => api.integrations.abha.link({ requestId: request!.id, patientId: patient!.id }),
    onSuccess: (l) => {
      setLinked(l);
      queryClient.invalidateQueries({ queryKey: ['integrations', 'abha'] });
      queryClient.invalidateQueries({ queryKey: ['integrations', 'care-contexts'] });
    },
  });

  const reset = () => {
    setRequest(null);
    setOtp('');
    setLinked(null);
    requestOtp.reset();
    verifyOtp.reset();
    link.reset();
  };

  const methods: I.AbhaOtpMethod[] = purpose === 'create' ? ['aadhaar', 'mobile'] : ['mobile', 'abha'];
  const profile = request?.status === 'verified' ? request.profile : null;
  const step = linked ? 4 : profile ? 3 : request ? 2 : 1;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Create or verify ABHA</CardTitle>
        <CardDescription>Pick the patient, choose how to authenticate, enter the OTP, then link the ABHA to the patient record.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {mode === 'mock' && <Notice>Mock mode: no OTP is actually sent. Use <span className="font-mono font-semibold">123456</span>.</Notice>}
        {mode === 'disabled' && <Notice tone="warn">ABDM is disabled in Integration settings. Requests will be refused until a mode is chosen.</Notice>}

        <ol className="flex flex-wrap gap-2 text-xs">
          {['Patient & method', 'Enter OTP', 'Confirm profile', 'Linked'].map((s, i) => (
            <li key={s}>
              <Badge variant={step === i + 1 ? 'default' : step > i + 1 ? 'accent' : 'secondary'}>
                {i + 1}. {s}
              </Badge>
            </li>
          ))}
        </ol>

        {step === 1 && (
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const v = validate(I.abhaOtpRequestSchema, { purpose, method, identifier: identifier.trim(), patientId: patient?.id });
              const message = patient ? firstError(v.errors) : 'Pick a patient';
              setIdError(message);
              if (!message) requestOtp.mutate();
            }}
          >
            <div className="sm:col-span-2">
              <PatientPicker value={patient} onChange={setPatient} />
            </div>
            <Field label="What do you want to do?" className="sm:col-span-2">
              <div className="flex flex-wrap gap-4 text-sm">
                {(['verify', 'create'] as const).map((p) => (
                  <label key={p} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="purpose"
                      checked={purpose === p}
                      onChange={() => {
                        setPurpose(p);
                        setMethod(p === 'create' ? 'aadhaar' : 'mobile');
                      }}
                    />
                    {p === 'verify' ? 'Verify an existing ABHA' : 'Create a new ABHA'}
                  </label>
                ))}
              </div>
            </Field>
            <Field id="method" label="Authenticate with">
              <Select id="method" value={method} onChange={(e) => setMethod(e.target.value as I.AbhaOtpMethod)}>
                {methods.map((m) => (
                  <option key={m} value={m}>
                    {METHOD_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="identifier" label={IDENTIFIER_HINT[method].label} error={idError ?? undefined}>
              <Input
                id="identifier"
                value={identifier}
                maxLength={64}
                onChange={(e) => {
                  setIdentifier(e.target.value);
                  setIdError(null);
                }}
                placeholder={IDENTIFIER_HINT[method].placeholder}
                inputMode={method === 'abha' ? 'text' : 'numeric'}
                autoComplete="off"
                required
              />
            </Field>
            <div className="sm:col-span-2">
              <ErrorBox error={requestOtp.error ? errorMessage(requestOtp.error) : null} />
            </div>
            <div className="flex justify-end sm:col-span-2">
              <Button type="submit" disabled={!patient || !identifier.trim() || requestOtp.isPending}>
                {requestOtp.isPending && <Loader2 className="animate-spin" />}
                Send OTP
              </Button>
            </div>
          </form>
        )}

        {step === 2 && request && (
          <form
            className="grid max-w-md gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              verifyOtp.mutate();
            }}
          >
            <p className="text-sm">
              OTP sent{request.sentTo ? <> to <span className="font-medium">{request.sentTo}</span></> : null} for {METHOD_LABELS[request.method]} ({request.identifierMasked}). Expires{' '}
              {formatDateTime(request.expiresAt)}.
            </p>
            <Field id="otp" label="6-digit OTP">
              <Input
                id="otp"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="font-mono tracking-[0.4em]"
                placeholder="••••••"
                autoFocus
              />
            </Field>
            <ErrorBox error={verifyOtp.error ? errorMessage(verifyOtp.error) : null} />
            {request.status === 'failed' || request.status === 'expired' ? <ErrorBox error={`This request is ${request.status}. Start again.`} /> : null}
            <div className="flex justify-between gap-2">
              <Button type="button" variant="outline" onClick={reset}>
                Start again
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" disabled={requestOtp.isPending} onClick={() => requestOtp.mutate()}>
                  Resend
                </Button>
                <Button type="submit" disabled={otp.length !== 6 || verifyOtp.isPending}>
                  {verifyOtp.isPending && <Loader2 className="animate-spin" />}
                  Verify OTP
                </Button>
              </div>
            </div>
          </form>
        )}

        {step === 3 && profile && (
          <div className="space-y-4">
            <ProfileCard profile={profile} />
            <ErrorBox error={link.error ? errorMessage(link.error) : null} />
            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={reset}>
                Start again
              </Button>
              <Button onClick={() => link.mutate()} disabled={!patient || link.isPending}>
                {link.isPending ? <Loader2 className="animate-spin" /> : <Link2 />}
                Link to {patient ? 'this patient' : 'patient'}
              </Button>
            </div>
          </div>
        )}

        {step === 4 && linked && (
          <div className="space-y-4">
            <Notice tone="success">
              ABHA {formatAbhaNumber(linked.abhaNumber)} linked to <PatientName id={linked.patientId} />.
            </Notice>
            <Button
              variant="outline"
              onClick={() => {
                reset();
                setPatient(null);
                setIdentifier('');
              }}
            >
              Link another
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProfileCard({ profile }: { profile: I.AbhaProfile }) {
  const rows: [string, React.ReactNode][] = [
    ['Name', profile.name],
    ['ABHA number', <span key="n" className="font-mono">{formatAbhaNumber(profile.abhaNumber)}</span>],
    ['ABHA address', profile.abhaAddress ?? '—'],
    ['Gender', genderLabel(profile.gender)],
    ['Year of birth', profile.yearOfBirth ?? '—'],
    ['Mobile', profile.mobile ?? '—'],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-2 rounded-md border bg-muted/30 p-4 text-sm sm:grid-cols-3">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function LinksTable({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState<'linked' | 'unlinked' | 'all'>('linked');
  const [page, setPage] = React.useState(1);
  const [unlinking, setUnlinking] = React.useState<I.AbhaLink | null>(null);
  const [reason, setReason] = React.useState('');
  const query: I.AbhaLinkQuery = { status, page, pageSize: PAGE_SIZE };
  const { data, isPending, error } = useQuery({
    queryKey: ['integrations', 'abha', 'links', query],
    queryFn: () => api.integrations.abha.links(query),
    placeholderData: keepPreviousData,
  });
  const unlink = useMutation({
    mutationFn: () => api.integrations.abha.unlink(unlinking!.id, { reason: reason.trim() }),
    onSuccess: () => {
      setUnlinking(null);
      setReason('');
      queryClient.invalidateQueries({ queryKey: ['integrations', 'abha'] });
    },
  });

  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <h2 className="font-semibold">ABHA links</h2>
        <Select
          className="w-40"
          aria-label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setPage(1);
          }}
        >
          <option value="linked">Linked</option>
          <option value="unlinked">Unlinked</option>
          <option value="all">All</option>
        </Select>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Patient</TableHead>
            <TableHead>ABHA number</TableHead>
            <TableHead>ABHA address</TableHead>
            <TableHead>Name on ABHA</TableHead>
            <TableHead>Via</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Linked</TableHead>
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
          ) : data.items.length === 0 ? (
            <MessageRow colSpan={8}>No ABHA links.</MessageRow>
          ) : (
            data.items.map((l) => (
              <TableRow key={l.id}>
                <TableCell>
                  <PatientName id={l.patientId} />
                </TableCell>
                <TableCell className="font-mono text-xs">{formatAbhaNumber(l.abhaNumber)}</TableCell>
                <TableCell>{l.abhaAddress ?? '—'}</TableCell>
                <TableCell>
                  {l.name}
                  <span className="block text-xs text-muted-foreground">
                    {l.gender ? genderLabel(l.gender) : '—'}
                    {l.yearOfBirth ? ` · ${l.yearOfBirth}` : ''}
                  </span>
                </TableCell>
                <TableCell className="text-xs">{l.verifiedVia === 'scan_share' ? 'Scan & Share' : METHOD_LABELS[l.verifiedVia]}</TableCell>
                <TableCell>
                  <StatusBadge status={l.status} />
                  {l.unlinkReason && <span className="block text-xs text-muted-foreground">{l.unlinkReason}</span>}
                </TableCell>
                <TableCell className="text-xs">{formatDate(l.linkedAt)}</TableCell>
                <TableCell className="text-right">
                  {canManage && l.status === 'linked' && (
                    <Button variant="ghost" size="sm" onClick={() => setUnlinking(l)}>
                      <Unlink /> Unlink
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {data && <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}

      <Dialog
        open={!!unlinking}
        onClose={() => {
          setUnlinking(null);
          unlink.reset();
        }}
        title="Unlink ABHA"
      >
        {unlinking && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              unlink.mutate();
            }}
          >
            <p className="text-sm">
              Unlink ABHA <span className="font-mono">{formatAbhaNumber(unlinking.abhaNumber)}</span> from <PatientName id={unlinking.patientId} />?
            </p>
            <Field id="reason" label="Reason *">
              <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Linked to the wrong patient" minLength={3} maxLength={300} required autoFocus />
            </Field>
            <ErrorBox error={unlink.error ? errorMessage(unlink.error) : null} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setUnlinking(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={reason.trim().length < 3 || unlink.isPending}>
                {unlink.isPending && <Loader2 className="animate-spin" />}
                Unlink
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </Card>
  );
}

function CareContextsTable({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState<I.CareContextStatus | 'all'>('all');
  const [page, setPage] = React.useState(1);
  const query: I.CareContextQuery = { status, page, pageSize: PAGE_SIZE };
  const { data, isPending, error } = useQuery({
    queryKey: ['integrations', 'care-contexts', query],
    queryFn: () => api.integrations.careContexts.list(query),
    placeholderData: keepPreviousData,
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.integrations.careContexts.retry(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['integrations', 'care-contexts'] }),
  });

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div>
          <h2 className="font-semibold">Care contexts</h2>
          <p className="text-sm text-muted-foreground">Visits and records this hospital (as HIP) has linked to patients&apos; ABHA.</p>
        </div>
        <Select
          className="w-40"
          aria-label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setPage(1);
          }}
        >
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="linked">Linked</option>
          <option value="failed">Failed</option>
        </Select>
      </div>
      {retry.error && (
        <div className="p-4 pb-0">
          <ErrorBox error={errorMessage(retry.error)} />
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Patient</TableHead>
            <TableHead>Care context</TableHead>
            <TableHead>Record types</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {error ? (
            <MessageRow colSpan={7} error>
              {errorMessage(error)}
            </MessageRow>
          ) : isPending ? (
            <MessageRow colSpan={7}>Loading…</MessageRow>
          ) : data.items.length === 0 ? (
            <MessageRow colSpan={7}>No care contexts yet. They are created as linked patients have visits.</MessageRow>
          ) : (
            data.items.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <PatientName id={c.patientId} />
                  <span className="block font-mono text-xs text-muted-foreground">{formatAbhaNumber(c.abhaNumber)}</span>
                </TableCell>
                <TableCell>
                  {c.display}
                  <span className="block font-mono text-xs text-muted-foreground">{c.reference}</span>
                </TableCell>
                <TableCell className="text-xs">{c.hiTypes.join(', ')}</TableCell>
                <TableCell className="text-xs">{c.sourceModule}</TableCell>
                <TableCell>
                  <StatusBadge status={c.status} />
                  {c.error && <span className="block max-w-xs text-xs text-destructive">{c.error}</span>}
                </TableCell>
                <TableCell className="text-xs">{formatDateTime(c.createdAt)}</TableCell>
                <TableCell className="text-right">
                  {canManage && c.status === 'failed' && (
                    <Button variant="ghost" size="sm" disabled={retry.isPending && retry.variables === c.id} onClick={() => retry.mutate(c.id)}>
                      {retry.isPending && retry.variables === c.id ? <Loader2 className="animate-spin" /> : <RotateCw />} Retry
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {data && <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </Card>
  );
}

export default function AbhaPage() {
  const canRead = usePermission('integrations.abha.read');
  const canManage = usePermission('integrations.abha.manage');
  if (!canRead) return <NoAccess />;
  return (
    <>
      <PageHeader title="ABHA" description="Ayushman Bharat Health Account: create or verify a patient's ABHA and link it to their hospital record." />
      {canManage && <AbhaFlow />}
      <LinksTable canManage={canManage} />
      <CareContextsTable canManage={canManage} />
    </>
  );
}
