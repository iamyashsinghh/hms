'use client';

import * as React from 'react';
import { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { emr } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/validate';
import { usePermission } from '@/lib/auth';
import { fullName } from '@/lib/format';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea, todayIso } from '@/modules/emr/ui';

const KIND_LABEL: Record<(typeof emr.CERTIFICATE_KINDS)[number], string> = {
  sick_leave: 'Sick leave / rest advised',
  fitness: 'Fitness certificate',
  medical: 'Medical certificate (general)',
};

function NewCertificate() {
  const canWrite = usePermission('emr.certificate.write');
  const router = useRouter();
  const params = useSearchParams();
  const patientId = params.get('patientId') ?? '';
  const encounterId = params.get('encounterId') ?? undefined;
  const patient = useQuery({ queryKey: ['patients', patientId], queryFn: () => api.patients.get(patientId), enabled: canWrite && !!patientId });
  const encounter = useQuery({ queryKey: ['emr', 'encounter', encounterId], queryFn: () => api.emr.get(encounterId!), enabled: canWrite && !!encounterId });
  const [kind, setKind] = React.useState<(typeof emr.CERTIFICATE_KINDS)[number]>('sick_leave');
  const [fromDate, setFromDate] = React.useState(todayIso);
  const [toDate, setToDate] = React.useState(todayIso);
  const [diagnosisInput, setDiagnosis] = React.useState<string | null>(null);
  const [remarks, setRemarks] = React.useState('');
  const [errors, setErrors] = React.useState<FieldErrors>({});

  // Until the doctor types, prefill from the consultation's diagnoses.
  const diagnosis = diagnosisInput ?? encounter.data?.diagnoses.map((x) => x.description).join(', ') ?? '';

  const create = useMutation({
    mutationFn: (body: emr.CreateCertificate) => api.emr.createCertificate(body),
    onSuccess: (c) => router.push(`/emr/certificates/${c.id}`),
  });

  if (!canWrite) return <NoAccess />;
  if (!patientId) return <p className="text-sm text-destructive">Open a patient first.</p>;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      patientId,
      encounterId,
      kind,
      fromDate: kind === 'fitness' ? fromDate || undefined : fromDate || undefined,
      toDate: kind === 'fitness' ? undefined : toDate || undefined,
      diagnosis: diagnosis || undefined,
      remarks: remarks || undefined,
    };
    const checked = validate(emr.createCertificateSchema, body);
    if (checked.errors) return setErrors(checked.errors);
    setErrors({});
    create.mutate(checked.data);
  };

  return (
    <div className="max-w-2xl">
      <Link href={`/emr/patients/${patientId}`} className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> Patient history
      </Link>
      <PageHeader title="Issue certificate" description={patient.data ? `${fullName(patient.data)} · ${patient.data.uhid}` : undefined} />
      <Card>
        <CardContent className="pt-6">
          <form className="space-y-4" onSubmit={submit}>
            <div>
              <Label htmlFor="kind">Type</Label>
              <Select id="kind" className="mt-1.5" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                {emr.CERTIFICATE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="from">{kind === 'fitness' ? 'Fit to resume from' : 'From'}</Label>
                <Input
                  id="from"
                  type="date"
                  className="mt-1.5"
                  min={todayIso(-emr.CERTIFICATE_MAX_BACKDATE_DAYS)}
                  value={fromDate}
                  aria-invalid={!!errors.fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                />
                {errors.fromDate && <p className="mt-1 text-xs text-destructive">{errors.fromDate}</p>}
              </div>
              {kind !== 'fitness' && (
                <div>
                  <Label htmlFor="to">To</Label>
                  <Input
                    id="to"
                    type="date"
                    className="mt-1.5"
                    min={fromDate || undefined}
                    max={todayIso(emr.CERTIFICATE_MAX_DAYS)}
                    value={toDate}
                    aria-invalid={!!errors.toDate}
                    onChange={(e) => setToDate(e.target.value)}
                  />
                  {errors.toDate && <p className="mt-1 text-xs text-destructive">{errors.toDate}</p>}
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="dx">Diagnosis / condition</Label>
              <Input id="dx" className="mt-1.5" maxLength={300} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="remarks">Remarks</Label>
              <Textarea id="remarks" className="mt-1.5" rows={3} maxLength={2000} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
            {(() => {
              const other = Object.entries(errors).find(([k]) => k !== 'fromDate' && k !== 'toDate')?.[1];
              const msg = other ?? (create.error ? errorMessage(create.error) : null);
              return msg ? <p className="text-sm text-destructive">{msg}</p> : null;
            })()}
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" />} Issue certificate
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function NewCertificatePage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <NewCertificate />
    </Suspense>
  );
}
