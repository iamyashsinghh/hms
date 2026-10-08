'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Pencil } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { ageOf, formatDate, fullName, genderLabel } from '@/lib/format';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm">{value || '—'}</dd>
    </div>
  );
}

export default function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('core.patient.read');
  const { data: p, isPending, error } = useQuery({
    queryKey: ['patients', id],
    queryFn: () => api.patients.get(id),
    enabled: canRead,
  });

  if (!canRead) return <NoAccess />;

  return (
    <div className="space-y-6">
      <Link href="/patients" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
        <ArrowLeft /> All patients
      </Link>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{errorMessage(error)}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex size-14 items-center justify-center rounded-full bg-secondary text-lg font-semibold text-primary">
              {p.firstName[0]?.toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{fullName(p)}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="outline" className="font-mono">
                  {p.uhid}
                </Badge>
                <span>
                  {genderLabel(p.gender)} · {ageOf(p)}
                </span>
                {p.bloodGroup && <Badge variant="accent">{p.bloodGroup}</Badge>}
              </div>
            </div>
            <Can permission="core.patient.update">
              <Link href={`/patients/${p.id}/edit`} className={buttonVariants({ variant: 'outline', className: 'ml-auto' })}>
                <Pencil /> Edit patient
              </Link>
            </Can>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Demographics</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-5 sm:grid-cols-2">
                  <Field label="First name" value={p.firstName} />
                  <Field label="Last name" value={p.lastName} />
                  <Field label="Gender" value={genderLabel(p.gender)} />
                  <Field label="Date of birth" value={p.dateOfBirth ? formatDate(p.dateOfBirth) : null} />
                  <Field label="Age" value={ageOf(p)} />
                  <Field label="Blood group" value={p.bloodGroup} />
                  <Field label="ABHA number" value={p.abhaNumber} />
                  <Field label="Registered" value={formatDate(p.createdAt)} />
                </dl>
              </CardContent>
            </Card>
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Contact</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="space-y-4">
                    <Field label="Mobile" value={p.mobile} />
                    <Field label="Email" value={p.email} />
                    <Field
                      label="Address"
                      value={[p.address?.line1, p.address?.city, p.address?.state, p.address?.pincode].filter(Boolean).join(', ')}
                    />
                  </dl>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Allergies</CardTitle>
                </CardHeader>
                <CardContent>
                  {p.allergies?.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {p.allergies.map((a) => (
                        <Badge key={a} variant="destructive">
                          {a}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No known allergies</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
