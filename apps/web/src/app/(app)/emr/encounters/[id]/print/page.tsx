'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth, usePermission } from '@/lib/auth';
import { genderLabel } from '@/lib/format';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { PrintStyles, TIMING_LABEL, ageFromDob, vitalsLine } from '@/modules/emr/ui';

export default function PrintRxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('emr.encounter.read');
  const { user, facility } = useAuth();
  const { data: enc, isPending, error } = useQuery({ queryKey: ['emr', 'encounter', id], queryFn: () => api.emr.get(id), enabled: canRead });

  if (!canRead) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;

  const v = enc.vitals.at(-1);
  const rx = enc.prescription;
  return (
    <div className="space-y-4">
      <PrintStyles />
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/emr/encounters/${id}`} className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
          <ArrowLeft /> Back
        </Link>
        <Button onClick={() => window.print()}>
          <Printer /> Print
        </Button>
      </div>
      {enc.status !== 'completed' && <p className="text-sm text-amber-700 print:hidden">Draft: this consultation is not signed yet.</p>}

      <article id="print-area" className="mx-auto max-w-[210mm] rounded-lg border bg-white p-8 text-[13px] leading-relaxed text-black shadow-sm">
        <header className="flex items-start justify-between border-b-2 border-black pb-3">
          <div>
            <h1 className="text-xl font-bold">{user?.tenantName}</h1>
            <p>{facility?.name}</p>
          </div>
          <div className="text-right">
            <p className="text-base font-semibold">{enc.doctorName}</p>
            <p className="text-xs">OPD consultation</p>
          </div>
        </header>

        <section className="mt-3 grid grid-cols-2 gap-x-6 gap-y-0.5 border-b pb-3">
          <p>
            <b>Patient:</b> {enc.patient.name} ({ageFromDob(enc.patient.dateOfBirth)} / {genderLabel(enc.patient.gender)})
          </p>
          <p className="text-right">
            <b>Date:</b> {new Date(enc.signedAt ?? enc.createdAt).toLocaleDateString('en-IN')}
          </p>
          <p>
            <b>UHID:</b> {enc.patient.uhid}
          </p>
          <p className="text-right">
            <b>{rx ? `Rx No: ${rx.rxNo}` : `Visit: ${enc.encounterNo}`}</b>
          </p>
          {enc.patient.allergies.length > 0 && (
            <p className="col-span-2">
              <b>Allergies:</b> {enc.patient.allergies.join(', ')}
            </p>
          )}
        </section>

        {v && <p className="mt-2 text-xs">{vitalsLine(v)}</p>}

        <section className="mt-3 space-y-1.5">
          {enc.notes.chiefComplaints && (
            <p>
              <b>Complaints:</b> {enc.notes.chiefComplaints}
            </p>
          )}
          {enc.notes.examination && (
            <p>
              <b>Examination:</b> {enc.notes.examination}
            </p>
          )}
          {enc.diagnoses.length > 0 && (
            <p>
              <b>Diagnosis:</b> {enc.diagnoses.map((d) => `${d.description}${d.icd10Code ? ` (${d.icd10Code})` : ''}`).join('; ')}
            </p>
          )}
        </section>

        {rx && (
          <section className="mt-4">
            <p className="text-2xl font-bold italic">℞</p>
            <table className="mt-1 w-full border-collapse text-left">
              <thead>
                <tr className="border-b">
                  <th className="py-1 pr-2">#</th>
                  <th className="py-1 pr-2">Medicine</th>
                  <th className="py-1 pr-2">Dose</th>
                  <th className="py-1 pr-2">Frequency</th>
                  <th className="py-1 pr-2">Duration</th>
                  <th className="py-1">Qty</th>
                </tr>
              </thead>
              <tbody>
                {rx.lines.map((l, i) => (
                  <tr key={l.id} className="border-b align-top">
                    <td className="py-1 pr-2">{i + 1}</td>
                    <td className="py-1 pr-2">
                      <b>{l.drugName}</b> {l.strength}
                      {l.genericName && <div className="text-xs">{l.genericName}</div>}
                      {(l.instructions || l.timing) && (
                        <div className="text-xs">{[l.timing ? TIMING_LABEL[l.timing] : '', l.instructions].filter(Boolean).join('. ')}</div>
                      )}
                    </td>
                    <td className="py-1 pr-2">{l.dose}</td>
                    <td className="py-1 pr-2">{l.frequency}</td>
                    <td className="py-1 pr-2">{l.days ? `${l.days} days` : '—'}</td>
                    <td className="py-1">{l.qty ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rx.notes && <p className="mt-2 text-xs">{rx.notes}</p>}
          </section>
        )}

        {enc.orders.length > 0 && (
          <p className="mt-3">
            <b>Investigations:</b> {enc.orders.map((o) => o.name + (o.priority === 'urgent' ? ' (urgent)' : '')).join(', ')}
          </p>
        )}
        {enc.notes.advice && (
          <p className="mt-2 whitespace-pre-wrap">
            <b>Advice:</b> {enc.notes.advice}
          </p>
        )}
        {enc.followUpDate && (
          <p className="mt-2">
            <b>Follow-up:</b> {new Date(enc.followUpDate).toLocaleDateString('en-IN')} {enc.followUpNotes}
          </p>
        )}

        <footer className="mt-12 flex justify-end">
          <div className="text-center">
            <div className="h-10" />
            <p className="border-t border-black px-6 pt-1 font-semibold">{enc.doctorName}</p>
            {enc.signedAt && <p className="text-[10px]">Digitally signed {new Date(enc.signedAt).toLocaleString('en-IN')}</p>}
          </div>
        </footer>
      </article>
    </div>
  );
}
