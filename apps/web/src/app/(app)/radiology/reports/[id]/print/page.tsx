'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth, usePermission } from '@/lib/auth';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { PrintStyles, dateTime } from '@/modules/radiology/ui';

export default function PrintRadiologyReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('radiology.report.read');
  const { user, facility } = useAuth();
  const { data, isPending, error } = useQuery({ queryKey: ['radiology', 'report', id], queryFn: () => api.radiology.report(id), enabled: canRead });

  if (!canRead) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;

  const { report: r, order: o } = data;
  const p = o.patient;
  return (
    <div className="space-y-4">
      <PrintStyles />
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/radiology/orders/${o.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
          <ArrowLeft /> Back
        </Link>
        <Button onClick={() => window.print()} disabled={r.status === 'draft'}>
          <Printer /> Print
        </Button>
      </div>
      {r.status === 'draft' && <p className="text-sm text-amber-700 print:hidden">Draft: this report is not signed yet and cannot be printed.</p>}
      {r.status === 'superseded' && <p className="text-sm text-amber-700 print:hidden">This version was replaced by an amended report.</p>}

      <article id="print-area" className="mx-auto max-w-[210mm] rounded-lg border bg-white p-8 text-[13px] leading-relaxed text-black shadow-sm">
        <header className="flex items-start justify-between border-b-2 border-black pb-3">
          <div>
            <h1 className="text-xl font-bold">{user?.tenantName}</h1>
            <p>{facility?.name}</p>
          </div>
          <div className="text-right">
            <p className="text-base font-semibold">Department of Radiology</p>
            <p className="text-xs">{o.modalityName}</p>
          </div>
        </header>

        <section className="mt-3 grid grid-cols-2 gap-x-6 gap-y-0.5 border-b pb-3">
          <p>
            <b>Patient:</b> {p.name} ({p.ageYears != null ? `${p.ageYears}y` : '—'} / {p.gender.charAt(0).toUpperCase() + p.gender.slice(1)})
          </p>
          <p className="text-right">
            <b>Order No:</b> {o.orderNo}
          </p>
          <p>
            <b>UHID:</b> {p.uhid}
          </p>
          <p className="text-right">
            <b>Scan date:</b> {dateTime(o.acquiredAt ?? o.startedAt)}
          </p>
          <p>
            <b>Referred by:</b> {o.referringDoctorName ?? 'Self'}
          </p>
          <p className="text-right">
            <b>Report date:</b> {dateTime(r.finalizedAt)}
          </p>
        </section>

        <h2 className="mt-4 text-center text-base font-bold uppercase underline">{o.studyName}</h2>
        {r.version > 1 && (
          <p className="mt-1 text-center text-xs font-semibold">
            AMENDED REPORT (version {r.version}){r.amendmentReason ? `: ${r.amendmentReason}` : ''}
          </p>
        )}

        {o.clinicalNotes && (
          <p className="mt-3">
            <b>Clinical details:</b> {o.clinicalNotes}
          </p>
        )}
        {r.technique && (
          <p className="mt-2">
            <b>Technique:</b> {r.technique}
          </p>
        )}
        <section className="mt-3">
          <p className="font-bold">Findings:</p>
          <p className="whitespace-pre-line">{r.findings}</p>
        </section>
        <section className="mt-3">
          <p className="font-bold">Impression:</p>
          <p className="whitespace-pre-line font-semibold">{r.impression}</p>
        </section>
        {r.isCritical && <p className="mt-3 border border-black p-2 font-bold">CRITICAL FINDING: communicated to the referring doctor.</p>}

        <footer className="mt-12 flex items-end justify-between">
          <p className="text-[11px]">This report is a professional opinion and should be correlated clinically.</p>
          <div className="text-right">
            <p className="font-semibold">{r.finalizedByName ?? ''}</p>
            <p className="text-xs">Radiologist</p>
          </div>
        </footer>
      </article>
    </div>
  );
}
