'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { formatDate, genderLabel } from '@/lib/format';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { ageFromDob } from '@/modules/emr/ui';
import { Letterhead, PrintFooter, PrintStyles, Signature, paperWidth } from '@/modules/emr/print';

const TITLE = { sick_leave: 'Medical Certificate for Leave', fitness: 'Certificate of Fitness', medical: 'Medical Certificate' } as const;

export default function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('emr.certificate.read');
  const { data, isPending, error } = useQuery({ queryKey: ['emr', 'certificate', id, 'print'], queryFn: () => api.emr.printCertificate(id), enabled: canRead });

  if (!canRead) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;

  const c = data.certificate;
  const who = `${c.patient.name} (${ageFromDob(c.patient.dateOfBirth)}, ${genderLabel(c.patient.gender)}, UHID ${c.patient.uhid})`;
  let body: string;
  if (c.kind === 'sick_leave') {
    body = `This is to certify that ${who} was examined by me and is suffering from ${c.diagnosis || 'an illness'}. Rest is advised from ${formatDate(c.fromDate)} to ${formatDate(c.toDate)}.`;
  } else if (c.kind === 'fitness') {
    body = `This is to certify that ${who} was examined by me${c.diagnosis ? ` after treatment for ${c.diagnosis}` : ''} and is fit to resume normal duties${c.fromDate ? ` from ${formatDate(c.fromDate)}` : ''}.`;
  } else {
    body = `This is to certify that ${who} was examined by me${c.diagnosis ? ` and is diagnosed with ${c.diagnosis}` : ''}${c.fromDate ? `, for the period ${formatDate(c.fromDate)}${c.toDate ? ` to ${formatDate(c.toDate)}` : ''}` : ''}.`;
  }

  return (
    <div className="space-y-4">
      <PrintStyles template={data.template} />
      <div className="flex items-center justify-between">
        <Link href={`/emr/patients/${c.patient.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
          <ArrowLeft /> Patient history
        </Link>
        <Button onClick={() => window.print()}>
          <Printer /> Print
        </Button>
      </div>
      <article id="print-area" style={{ maxWidth: paperWidth(data) }} className="mx-auto rounded-lg border bg-white p-10 text-[14px] leading-7 text-black shadow-sm">
        <Letterhead header={data} fallbackName={c.doctorName} showDoctor={false} />
        <div className="mt-4 flex justify-between text-sm">
          <span>No: {c.certificateNo}</span>
          <span>Date: {formatDate(c.issuedAt)}</span>
        </div>
        <h2 className="mt-6 text-center text-lg font-semibold underline">{TITLE[c.kind]}</h2>
        <p className="mt-6">{body}</p>
        {c.remarks && <p className="mt-3 whitespace-pre-wrap">{c.remarks}</p>}
        <footer className="mt-20 flex justify-end">
          <Signature header={data} fallbackName={c.doctorName} />
        </footer>
        <PrintFooter header={data} />
      </article>
    </div>
  );
}
