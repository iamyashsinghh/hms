'use client';

import * as React from 'react';
import Link from 'next/link';
import { use } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BadgeCheck, FilePlus2, FileStack, Loader2 } from 'lucide-react';
import type { insurance as I } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PolicyForm } from '@/modules/insurance/policy-form';
import { ErrorBox, RELATION_LABELS, StatusBadge, coverText, formatINR } from '@/modules/insurance/ui';

export default function PolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('insurance.policy.read');
  const canManage = usePermission('insurance.policy.manage');
  const canPreauths = usePermission('insurance.preauth.read');
  const canClaims = usePermission('insurance.claim.read');
  const queryClient = useQueryClient();
  const key = ['insurance', 'policies', id];
  const { data: p, isPending, error } = useQuery({ queryKey: key, queryFn: () => api.insurance.policies.get(id), enabled: canRead });
  const [editing, setEditing] = React.useState(false);
  const [check, setCheck] = React.useState<I.EligibilityResult | null>(null);
  const verify = useMutation({
    mutationFn: () => api.insurance.policies.verify(id),
    onSuccess: (r) => {
      setCheck(r);
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const save = useMutation({
    mutationFn: (body: I.PolicyInput) => api.insurance.policies.update(id, { ...body, patientId: undefined } as I.UpdatePolicy),
    onSuccess: (next) => {
      queryClient.setQueryData(key, next);
      setEditing(false);
    },
  });
  const toggle = useMutation({
    mutationFn: () => api.insurance.policies.update(id, { isActive: !p!.isActive }),
    onSuccess: (next) => queryClient.setQueryData(key, next),
  });
  const preauths = useQuery({
    queryKey: ['insurance', 'preauths', { patientId: p?.patientId }],
    queryFn: () => api.insurance.preauths.list({ patientId: p!.patientId, pageSize: 20 }),
    enabled: !!p && canPreauths,
  });
  const claims = useQuery({
    queryKey: ['insurance', 'claims', { patientId: p?.patientId }],
    queryFn: () => api.insurance.claims.list({ patientId: p!.patientId, pageSize: 20 }),
    enabled: !!p && canClaims,
  });

  if (!canRead) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;

  return (
    <div className="space-y-6">
      <Link href="/insurance/policies" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
        <ArrowLeft /> All policies
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            {p.payerName} {p.verifiedAt && <Badge>Verified {formatDate(p.verifiedAt)}</Badge>} {!p.isActive && <Badge variant="outline">Inactive</Badge>}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href={`/patients/${p.patientId}`} className="hover:underline">
              {p.patientName}
            </Link>{' '}
            · <span className="font-mono">{p.patientUhid}</span> · policy <span className="font-mono">{p.policyNumber}</span>
            {p.tpaName && ` · TPA ${p.tpaName}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Can permission="insurance.policy.manage">
            <Button variant="outline" disabled={verify.isPending} onClick={() => verify.mutate()}>
              {verify.isPending ? <Loader2 className="animate-spin" /> : <BadgeCheck />} Check eligibility
            </Button>
            <Button variant="outline" onClick={() => setEditing((e) => !e)}>
              Edit
            </Button>
            <Button variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
              {p.isActive ? 'Mark inactive' : 'Mark active'}
            </Button>
          </Can>
          <Can permission="insurance.preauth.manage">
            <Link href={`/insurance/preauths/new?policyId=${id}`} className={buttonVariants({ variant: 'outline' })}>
              <FilePlus2 /> Pre-auth
            </Link>
          </Can>
          <Can permission="insurance.claim.manage">
            <Link href={`/insurance/claims/new?policyId=${id}`} className={buttonVariants()}>
              <FileStack /> Claim
            </Link>
          </Can>
        </div>
      </div>

      {check && (
        <div className={`rounded-md border px-3 py-2 text-sm ${check.eligible ? 'border-primary/30 bg-primary/5' : 'border-destructive/30 bg-destructive/5 text-destructive'}`}>
          {check.eligible ? 'Eligible: the policy on file is active and in date.' : `Not eligible: ${check.reasons.join('; ')}.`}{' '}
          <span className="text-muted-foreground">Checked against the details on file; no call is made to the insurer yet.</span>
        </div>
      )}
      <ErrorBox error={verify.error ? errorMessage(verify.error) : toggle.error ? errorMessage(toggle.error) : null} />

      {editing && canManage ? (
        <Card>
          <CardContent className="pt-6">
            <PolicyForm policy={p} onSubmit={(b) => save.mutate(b)} pending={save.isPending} error={save.error ? errorMessage(save.error) : null} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="grid gap-4 pt-6 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Info label="Member / card ID" value={p.memberId} />
            <Info label="Holder" value={p.holderName ? `${p.holderName} (${RELATION_LABELS[p.relation]})` : RELATION_LABELS[p.relation]} />
            <Info label="Cover" value={coverText(p)} />
            <Info label="Employee code" value={p.employeeId} />
            <Info label="Sum insured" value={p.sumInsured != null ? formatINR(p.sumInsured) : null} />
            <Info label="Sum insured left" value={p.balanceSumInsured != null ? formatINR(p.balanceSumInsured) : null} />
            <Info label="Co-pay" value={p.copayPercent != null ? `${p.copayPercent}%` : 'Payer default'} />
            <Info label="Room rent limit" value={p.roomRentLimit != null ? `${formatINR(p.roomRentLimit)} / day` : null} />
            {p.notes && <Info label="Notes" value={p.notes} />}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pre-auths for this patient</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(preauths.data?.items ?? []).map((a) => (
              <Link key={a.id} href={`/insurance/preauths/${a.id}`} className="flex items-center justify-between rounded px-2 py-1 hover:bg-muted">
                <span>
                  <span className="font-mono text-xs">{a.number}</span> {a.diagnosis}
                </span>
                <StatusBadge status={a.status} />
              </Link>
            ))}
            {preauths.data?.items.length === 0 && <p className="text-muted-foreground">None yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Claims for this patient</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(claims.data?.items ?? []).map((c) => (
              <Link key={c.id} href={`/insurance/claims/${c.id}`} className="flex items-center justify-between rounded px-2 py-1 hover:bg-muted">
                <span>
                  <span className="font-mono text-xs">{c.number}</span> {formatINR(c.claimedAmount)}
                </span>
                <StatusBadge status={c.status} />
              </Link>
            ))}
            {claims.data?.items.length === 0 && <p className="text-muted-foreground">None yet.</p>}
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
