'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth, usePermission } from '@/lib/auth';
import { formatDate, genderLabel } from '@/lib/format';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { DISCHARGE_TYPE_LABELS, formatDateTime } from '@/modules/ipd/ui';

/** Printable discharge summary on the hospital letterhead. */
export default function PrintSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('ipd.admission.read');
  const canProfile = usePermission('setup.profile.read');
  const { facility } = useAuth();
  const { data: a, error } = useQuery({ queryKey: ['ipd', 'admission', id], queryFn: () => api.ipd.admissions.get(id), enabled: canRead });
  const { data: s } = useQuery({ queryKey: ['ipd', 'summary', id], queryFn: () => api.ipd.summary.get(id), enabled: canRead });
  const { data: profile } = useQuery({ queryKey: ['setup', 'profile'], queryFn: () => api.setup.getProfile(), enabled: canProfile, retry: false });

  if (!canRead) return <NoAccess />;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  if (!a || !s) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const sum = s.summary;
  if (!sum) return <p className="text-sm text-muted-foreground">No discharge summary has been written yet.</p>;

  const addr = profile?.address;
  const sections: [string, string | null][] = [
    ['Presenting complaints', sum.presentingComplaints],
    ['Relevant history', sum.history],
    ['Examination on admission', sum.examination],
    ['Key investigations', sum.investigations],
    ['Procedures / surgery', sum.procedures],
    ['Course in hospital', sum.hospitalCourse],
    ['Condition at discharge', sum.conditionAtDischarge],
  ];

  return (
    <>
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #summary-print, #summary-print * { visibility: visible !important; }
        #summary-print { position: absolute; left: 0; top: 0; width: 100%; padding: 0; box-shadow: none; border: 0; }
        @page { size: A4; margin: 14mm; }
      }`}</style>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/ipd/admissions/${id}`} className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
          <ArrowLeft /> Back to admission
        </Link>
        <Button onClick={() => window.print()}>
          <Printer /> Print
        </Button>
      </div>

      <div id="summary-print" className="mx-auto max-w-3xl rounded-lg border bg-white p-8 text-[13px] leading-snug text-black shadow-sm">
        <header className="border-b pb-3 text-center">
          <h1 className="text-xl font-bold">{profile?.displayName ?? facility?.name ?? 'Hospital'}</h1>
          {profile?.letterhead?.tagline && <p>{profile.letterhead.tagline}</p>}
          {addr && <p>{Object.values(addr).filter((v) => typeof v === 'string' && v).join(', ')}</p>}
          {profile?.phone && <p>Phone: {profile.phone}</p>}
        </header>
        <h2 className="my-3 text-center text-base font-semibold uppercase tracking-wide">
          Discharge Summary{sum.status !== 'final' && <span className="ml-2 text-red-600">(Draft)</span>}
        </h2>

        <table className="mb-4 w-full border-collapse text-left">
          <tbody>
            <tr>
              <Cell label="Patient">{a.patientName}</Cell>
              <Cell label="UHID">{a.patientUhid}</Cell>
              <Cell label="IPD no.">{a.ipdNo}</Cell>
            </tr>
            <tr>
              <Cell label="Age / sex">
                {a.patientDob ? `${new Date().getFullYear() - new Date(a.patientDob).getFullYear()}y` : '—'}
                {a.patientGender ? ` / ${genderLabel(a.patientGender)}` : ''}
              </Cell>
              <Cell label="Consultant">Dr. {a.doctorName.replace(/^Dr\.?\s*/i, '')}</Cell>
              <Cell label="Ward / bed">{a.stays.at(-1)?.bedLabel ?? '—'}</Cell>
            </tr>
            <tr>
              <Cell label="Admitted">{formatDateTime(a.admittedAt)}</Cell>
              <Cell label="Discharged">{a.dischargedAt ? formatDateTime(a.dischargedAt) : '—'}</Cell>
              <Cell label="Discharge type">{a.dischargeType ? DISCHARGE_TYPE_LABELS[a.dischargeType] : '—'}</Cell>
            </tr>
          </tbody>
        </table>

        <Section title="Final diagnosis">{sum.finalDiagnosis}</Section>
        {sections.map(([t, v]) => v && <Section key={t} title={t}>{v}</Section>)}

        {sum.medications.length > 0 && (
          <div className="mb-3">
            <h3 className="mb-1 font-semibold">Medicines on discharge</h3>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b">
                  <th className="py-1 pr-2">#</th>
                  <th className="py-1 pr-2">Medicine</th>
                  <th className="py-1 pr-2">Dose</th>
                  <th className="py-1 pr-2">Frequency</th>
                  <th className="py-1 pr-2">Days</th>
                  <th className="py-1">Instructions</th>
                </tr>
              </thead>
              <tbody>
                {sum.medications.map((m, i) => (
                  <tr key={i} className="border-b border-dashed">
                    <td className="py-1 pr-2">{i + 1}</td>
                    <td className="py-1 pr-2 font-medium">{m.drugName}</td>
                    <td className="py-1 pr-2">{m.dose ?? ''}</td>
                    <td className="py-1 pr-2">{m.frequency ?? ''}</td>
                    <td className="py-1 pr-2">{m.days ?? ''}</td>
                    <td className="py-1">{m.instructions ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {sum.advice && <Section title="Advice">{sum.advice}</Section>}
        {(sum.followUpDate || sum.followUpNotes) && (
          <Section title="Follow-up">
            {sum.followUpDate ? formatDate(sum.followUpDate) : ''}
            {sum.followUpNotes ? ` · ${sum.followUpNotes}` : ''}
          </Section>
        )}
        <p className="mt-4 text-xs">In case of fever, bleeding, breathlessness, severe pain or any emergency, contact the hospital immediately.</p>

        <footer className="mt-10 flex justify-between">
          <div className="text-xs">{profile?.letterhead?.footerNote}</div>
          <div className="text-right">
            <p className="font-semibold">{sum.finalizedByName ? `Dr. ${sum.finalizedByName.replace(/^Dr\.?\s*/i, '')}` : ''}</p>
            <p className="text-xs">{sum.finalizedAt ? `Signed ${formatDateTime(sum.finalizedAt)}` : 'Not signed'}</p>
          </div>
        </footer>
      </div>
    </>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <td className="w-1/3 border px-2 py-1 align-top">
      <span className="block text-[11px] uppercase text-gray-500">{label}</span>
      {children}
    </td>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <h3 className="font-semibold">{title}</h3>
      <p className="whitespace-pre-wrap">{children}</p>
    </div>
  );
}
