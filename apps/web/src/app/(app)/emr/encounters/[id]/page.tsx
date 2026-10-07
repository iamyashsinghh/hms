'use client';

import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, FileText, History, Lock, Printer, XCircle } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth, usePermission } from '@/lib/auth';
import { genderLabel } from '@/lib/format';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { StatusBadge, ageFromDob } from '@/modules/emr/ui';
import { AddendaCard, DiagnosesCard, NotesCard, OrdersCard, PrescriptionCard, VitalsCard } from '@/modules/emr/workspace';

export default function EncounterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('emr.encounter.read');
  const canSign = usePermission('emr.encounter.sign');
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: enc, isPending, error } = useQuery({ queryKey: ['emr', 'encounter', id], queryFn: () => api.emr.get(id), enabled: canRead });

  const sign = useMutation({
    mutationFn: () => api.emr.sign(id),
    onSuccess: (e) => {
      qc.setQueryData(['emr', 'encounter', id], e);
      qc.invalidateQueries({ queryKey: ['emr', 'queue'] });
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.emr.cancel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emr'] });
      router.push('/emr');
    },
  });

  if (!canRead) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;

  const open = enc.status === 'waiting' || enc.status === 'in_progress';
  const mine = enc.doctorId === user?.id;
  const editable = open && mine;
  const allergies = enc.patient.allergies.filter((a) => !/^(nkda|none|nil)$/i.test(a));

  return (
    <div className="space-y-6">
      <Link href="/emr" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
        <ArrowLeft /> Queue
      </Link>

      <div className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{enc.patient.name}</h1>
            <StatusBadge status={enc.status} />
            {enc.tokenNo != null && <Badge variant="outline">Token {enc.tokenNo}</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="font-mono">{enc.patient.uhid}</span>
            <span>
              {ageFromDob(enc.patient.dateOfBirth)} · {genderLabel(enc.patient.gender)}
            </span>
            {enc.patient.mobile && <span>{enc.patient.mobile}</span>}
            <span>
              {enc.encounterNo} · {enc.encounterDate} · {enc.doctorName ?? 'Doctor'}
            </span>
          </div>
          {allergies.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-sm font-medium text-destructive">
              <AlertTriangle className="size-4" /> Allergic to {allergies.join(', ')}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/emr/patients/${enc.patient.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <History /> History
          </Link>
          <Link href={`/emr/certificates/new?patientId=${enc.patient.id}&encounterId=${enc.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <FileText /> Certificate
          </Link>
          {enc.prescription || enc.status === 'completed' ? (
            <Link href={`/emr/encounters/${enc.id}/print`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              <Printer /> Print Rx
            </Link>
          ) : null}
          {editable && (
            <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => window.confirm('Cancel this consultation?') && cancel.mutate()}>
              <XCircle /> Cancel
            </Button>
          )}
          {editable && canSign && (
            <Button
              size="sm"
              disabled={sign.isPending}
              onClick={() => window.confirm('Sign and lock this consultation? It cannot be edited after signing.') && sign.mutate()}
            >
              <Lock /> Sign & lock
            </Button>
          )}
        </div>
      </div>
      {(sign.error || cancel.error) && <p className="text-sm text-destructive">{errorMessage(sign.error ?? cancel.error)}</p>}
      {open && !mine && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          This consultation belongs to {enc.doctorName ?? 'another doctor'}. You can record vitals; only the consulting doctor can write notes and sign.
        </p>
      )}
      {enc.status === 'completed' && (
        <p className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Lock className="size-4" /> Signed {enc.signedAt ? new Date(enc.signedAt).toLocaleString('en-IN') : ''}. Corrections go in an addendum.
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-5" key={enc.status}>
        <div className="space-y-6 xl:col-span-3">
          <VitalsCard enc={enc} editable={open} />
          <NotesCard enc={enc} editable={editable} />
        </div>
        <div className="space-y-6 xl:col-span-2">
          <DiagnosesCard enc={enc} editable={editable} />
          <OrdersCard enc={enc} editable={editable} />
        </div>
        <div className="xl:col-span-5">
          <PrescriptionCard enc={enc} editable={editable} />
        </div>
        {enc.status === 'completed' && (
          <div className="xl:col-span-5">
            <AddendaCard enc={enc} />
          </div>
        )}
      </div>
    </div>
  );
}
