'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileText, Plus } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { ageOf, formatDate, fullName, genderLabel } from '@/lib/format';
import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge, vitalsLine } from '@/modules/emr/ui';

const PAGE_SIZE = 10;

export default function PatientTimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('emr.encounter.read');
  const canCerts = usePermission('emr.certificate.read');
  const router = useRouter();
  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const patient = useQuery({ queryKey: ['patients', id], queryFn: () => api.patients.get(id), enabled: canRead });
  const timeline = useQuery({ queryKey: ['emr', 'timeline', id, page], queryFn: () => api.emr.timeline(id, { page, pageSize: PAGE_SIZE }), enabled: canRead });
  const certs = useQuery({ queryKey: ['emr', 'certificates', id], queryFn: () => api.emr.patientCertificates(id), enabled: canCerts });
  const open = useMutation({
    mutationFn: () => api.emr.open({ patientId: id }),
    onSuccess: (e) => {
      qc.invalidateQueries({ queryKey: ['emr', 'queue'] });
      router.push(`/emr/encounters/${e.id}`);
    },
  });

  if (!canRead) return <NoAccess />;
  const p = patient.data;
  const pages = timeline.data ? Math.max(1, Math.ceil(timeline.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6">
      <Link href="/emr" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
        <ArrowLeft /> Queue
      </Link>
      <PageHeader
        title={p ? fullName(p) : 'Patient history'}
        description={p ? `${p.uhid} · ${genderLabel(p.gender)} · ${ageOf(p)}${p.allergies?.length ? ` · Allergies: ${p.allergies.join(', ')}` : ''}` : undefined}
        actions={
          <Can permission="emr.encounter.write">
            <Button disabled={open.isPending} onClick={() => open.mutate()}>
              <Plus /> New consultation
            </Button>
          </Can>
        }
      />
      {(patient.error || timeline.error || open.error) && <p className="text-sm text-destructive">{errorMessage(patient.error ?? timeline.error ?? open.error)}</p>}

      <div className="grid gap-6 xl:grid-cols-3">
        <ol className="relative space-y-4 border-l pl-6 xl:col-span-2">
          {timeline.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
          {timeline.data?.items.length === 0 && <p className="text-sm text-muted-foreground">No consultations yet.</p>}
          {timeline.data?.items.map((e) => (
            <li key={e.encounterId} className="relative">
              <span className="absolute -left-[31px] top-5 size-3 rounded-full border-2 border-background bg-primary" />
              <Card>
                <CardContent className="space-y-2 pt-5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/emr/encounters/${e.encounterId}`} className="font-semibold text-primary hover:underline">
                      {formatDate(e.encounterDate)}
                    </Link>
                    <span className="text-muted-foreground">
                      {e.encounterNo} · {e.doctorName}
                    </span>
                    <StatusBadge status={e.status} />
                  </div>
                  {e.chiefComplaints && <p>{e.chiefComplaints}</p>}
                  {e.vitals && <p className="text-xs text-muted-foreground">{vitalsLine(e.vitals)}</p>}
                  {e.diagnoses.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {e.diagnoses.map((d, i) => (
                        <Badge key={i} variant={d.isPrimary ? 'default' : 'secondary'}>
                          {d.icd10Code ? `${d.icd10Code} ` : ''}
                          {d.description}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {e.medicines.length > 0 && (
                    <p className="text-muted-foreground">
                      <span className="font-medium text-foreground">Rx:</span>{' '}
                      {e.medicines.map((m) => `${m.drugName} ${m.dose} ${m.frequency}${m.days ? ` × ${m.days}d` : ''}`).join('; ')}
                    </p>
                  )}
                  {e.orders.length > 0 && (
                    <p className="text-muted-foreground">
                      <span className="font-medium text-foreground">Orders:</span> {e.orders.map((o) => o.name).join(', ')}
                    </p>
                  )}
                  {e.followUpDate && <p className="text-xs">Follow-up {formatDate(e.followUpDate)}</p>}
                </CardContent>
              </Card>
            </li>
          ))}
          {pages > 1 && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((x) => x - 1)}>
                Newer
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((x) => x + 1)}>
                Older
              </Button>
            </div>
          )}
        </ol>
        {canCerts && (
          <Card className="h-fit">
            <CardContent className="space-y-3 pt-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Certificates</h3>
                <Can permission="emr.certificate.write">
                  <Link href={`/emr/certificates/new?patientId=${id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                    <Plus /> Issue
                  </Link>
                </Can>
              </div>
              {certs.data?.length === 0 && <p className="text-sm text-muted-foreground">None issued.</p>}
              <ul className="space-y-1.5 text-sm">
                {certs.data?.map((c) => (
                  <li key={c.id}>
                    <Link href={`/emr/certificates/${c.id}`} className="flex items-center gap-2 text-primary hover:underline">
                      <FileText className="size-4" /> {c.certificateNo} · {c.kind.replace('_', ' ')} · {formatDate(c.issuedAt)}
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
