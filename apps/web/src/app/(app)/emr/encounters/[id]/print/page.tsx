'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { genderLabel } from '@/lib/format';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { TIMING_LABEL, ageFromDob, vitalsLine } from '@/modules/emr/ui';
import { Letterhead, PrintFooter, PrintStyles, Signature, paperWidth } from '@/modules/emr/print';

export default function PrintRxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('emr.encounter.read');
  const { data, isPending, error } = useQuery({ queryKey: ['emr', 'encounter', id, 'print'], queryFn: () => api.emr.printEncounter(id), enabled: canRead });

  if (!canRead) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;

  const enc = data.encounter;
  const v = enc.vitals.at(-1);
  const rx = enc.prescription;
  return (
    <div className="space-y-4">
      <PrintStyles template={data.template} />
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/emr/encounters/${id}`} className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
          <ArrowLeft /> Back
        </Link>
        <Button onClick={() => window.print()}>
          <Printer /> Print
        </Button>
      </div>
      {enc.status !== 'completed' && <p className="text-sm text-amber-700 print:hidden">Draft: this consultation is not signed yet.</p>}

      <article id="print-area" style={{ maxWidth: paperWidth(data) }} className="mx-auto rounded-lg border bg-white p-8 text-[13px] leading-relaxed text-black shadow-sm">
        <Letterhead header={data} fallbackName={enc.doctorName} />

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
          <Signature header={data} fallbackName={enc.doctorName} signedAt={enc.signedAt} />
        </footer>
        <PrintFooter header={data} />
      </article>
    </div>
  );
}
