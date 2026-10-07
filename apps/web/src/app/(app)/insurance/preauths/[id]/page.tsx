'use client';

import * as React from 'react';
import Link from 'next/link';
import { use } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileStack } from 'lucide-react';
import type { insurance as I } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { NoAccess } from '@/components/no-access';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ActionForm, ErrorBox, History, StatusBadge, formatINR, opt } from '@/modules/insurance/ui';

export default function PreauthPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('insurance.preauth.read');
  const queryClient = useQueryClient();
  const key = ['insurance', 'preauths', id];
  const { data: pa, isPending, error } = useQuery({ queryKey: key, queryFn: () => api.insurance.preauths.get(id), enabled: canRead });
  const act = useMutation({
    mutationFn: (fn: () => Promise<I.Preauth>) => fn(),
    onSuccess: (next) => {
      queryClient.setQueryData(key, next);
      queryClient.invalidateQueries({ queryKey: ['insurance'], refetchType: 'none' });
    },
  });
  const run = (fn: () => Promise<I.Preauth>) => act.mutate(fn);

  if (!canRead) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  const pre = api.insurance.preauths;

  return (
    <div className="space-y-6">
      <Link href="/insurance/preauths" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
        <ArrowLeft /> Pre-auths
      </Link>
      <div>
        <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
          Pre-auth {pa.number} <StatusBadge status={pa.status} />
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <Link href={`/insurance/policies/${pa.policyId}`} className="hover:underline">
            {pa.patientName}
          </Link>{' '}
          · <span className="font-mono">{pa.patientUhid}</span> · {pa.payerName} · policy <span className="font-mono">{pa.policy.policyNumber}</span>
        </p>
      </div>

      <Can permission="insurance.preauth.manage">
        <div className="flex flex-wrap gap-2">
          {(pa.status === 'draft' || pa.status === 'query') && (
            <ActionForm
              label={pa.status === 'draft' ? 'Submit to payer' : 'Answer query and resubmit'}
              variant="default"
              fields={[
                { name: 'payerRef', label: 'Payer reference (optional)' },
                { name: 'note', label: 'Note (optional)' },
              ]}
              pending={act.isPending}
              onSubmit={(f) => run(() => pre.submit(id, { payerRef: opt(f.payerRef!), note: opt(f.note!) }))}
            />
          )}
          {(pa.status === 'submitted' || pa.status === 'query') && (
            <>
              <ActionForm
                label="Record approval"
                variant="default"
                fields={[
                  { name: 'approvedAmount', label: 'Approved ₹', type: 'number', required: true, defaultValue: String(pa.requestedAmount) },
                  { name: 'payerRef', label: 'Authorisation no.' },
                  { name: 'validUntil', label: 'Valid until', type: 'date' },
                ]}
                pending={act.isPending}
                onSubmit={(f) => run(() => pre.approve(id, { approvedAmount: Number(f.approvedAmount), payerRef: opt(f.payerRef!), validUntil: opt(f.validUntil!) }))}
              />
              {pa.status === 'submitted' && (
                <ActionForm label="Payer query" fields={[{ name: 'note', label: 'What the payer asked', required: true }]} pending={act.isPending} onSubmit={(f) => run(() => pre.query(id, { note: f.note! }))} />
              )}
              <ActionForm label="Rejected" variant="destructive" fields={[{ name: 'note', label: 'Reason', required: true }]} pending={act.isPending} onSubmit={(f) => run(() => pre.reject(id, { note: f.note! }))} />
            </>
          )}
          {pa.status === 'approved' && (
            <>
              <Can permission="insurance.claim.manage">
                <Link href={`/insurance/claims/new?policyId=${pa.policyId}&preauthId=${pa.id}`} className={buttonVariants()}>
                  <FileStack /> Prepare claim
                </Link>
              </Can>
              <ActionForm
                label="Ask for enhancement"
                fields={[
                  { name: 'requestedAmount', label: 'New total ₹', type: 'number', required: true },
                  { name: 'note', label: 'Why (e.g. longer stay)', required: true },
                ]}
                pending={act.isPending}
                onSubmit={(f) => run(() => pre.enhance(id, { requestedAmount: Number(f.requestedAmount), note: f.note! }))}
              />
            </>
          )}
          {pa.status !== 'rejected' && pa.status !== 'cancelled' && (
            <ActionForm label="Cancel" variant="destructive" fields={[{ name: 'note', label: 'Reason', required: true }]} pending={act.isPending} onSubmit={(f) => run(() => pre.cancel(id, { note: f.note! }))} />
          )}
        </div>
      </Can>
      <ErrorBox error={act.error ? errorMessage(act.error) : null} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="grid gap-4 pt-6 text-sm sm:grid-cols-2">
            <Info label="Diagnosis" value={pa.diagnosis} />
            <Info label="ICD-10" value={pa.icdCodes.join(', ') || null} />
            <Info label="Treatment / procedure" value={pa.procedure} />
            <Info label="Package" value={pa.packageCode ? `${pa.packageCode} · ${pa.packageName}` : null} />
            <Info label="Expected admission" value={pa.expectedAdmission ? formatDate(pa.expectedAdmission) : null} />
            <Info label="Expected stay" value={pa.expectedLosDays != null ? `${pa.expectedLosDays} days` : null} />
            <Info label="Estimate" value={formatINR(pa.estimatedAmount)} />
            <Info label="Requested" value={formatINR(pa.requestedAmount)} />
            <Info label="Approved" value={pa.approvedAmount != null ? formatINR(pa.approvedAmount) : null} />
            <Info label="Authorisation no." value={pa.payerRef} />
            <Info label="Valid until" value={pa.validUntil ? formatDate(pa.validUntil) : null} />
            <Info label="Admission / IP no." value={pa.admissionRef} />
            {pa.notes && <Info label="Notes" value={pa.notes} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <History events={pa.history} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value ?? '—'}</div>
    </div>
  );
}
