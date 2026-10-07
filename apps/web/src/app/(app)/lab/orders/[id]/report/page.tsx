'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { lab as L } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Barcode } from '@/modules/lab/barcode';
import { FLAG_LABELS, ageFromDob, formatDateTime, groupBySection, rangeText } from '@/modules/lab/ui';

export default function LabReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('lab.order.read');
  const { data, error } = useQuery({ queryKey: ['lab', 'report', id], queryFn: () => api.lab.orders.report(id), enabled: canRead });

  if (!canRead) return <NoAccess />;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const { order, hospital } = data;
  const final = order.status === 'completed';
  const firstCollected = order.samples.map((s) => s.collectedAt).filter(Boolean).sort()[0] ?? null;
  const shown = order.results.filter((r) => r.status === 'verified' || (!final && r.value));

  return (
    <>
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #lab-report, #lab-report * { visibility: visible !important; }
        #lab-report { position: absolute; left: 0; top: 0; width: 100%; padding: 0; box-shadow: none; border: 0; }
        @page { size: A4; margin: 12mm; }
      }`}</style>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/lab/orders/${id}`} className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
          <ArrowLeft /> Back to order
        </Link>
        <Button onClick={() => window.print()}>
          <Printer /> Print
        </Button>
      </div>

      <div id="lab-report" className="relative mx-auto max-w-3xl rounded-lg border bg-white p-8 text-[13px] leading-snug text-black shadow-sm">
        {!final && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="-rotate-30 text-6xl font-bold uppercase tracking-widest text-gray-200">Provisional</span>
          </div>
        )}
        <header className="flex items-start justify-between gap-4 border-b pb-4">
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {hospital.logoUrl && <img src={hospital.logoUrl} alt="" className="h-14 w-14 object-contain" />}
            <div>
              <h1 className="text-xl font-bold">{hospital.name}</h1>
              {hospital.address && <p>{hospital.address}</p>}
              <p>{[hospital.phone && `Phone: ${hospital.phone}`, hospital.email].filter(Boolean).join(' · ')}</p>
              {(hospital.registrationNo || hospital.accreditation) && <p>{[hospital.registrationNo && `Reg. ${hospital.registrationNo}`, hospital.accreditation].filter(Boolean).join(' · ')}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold uppercase tracking-wide">Laboratory report</p>
            <Barcode value={order.orderNo} height={28} moduleWidth={1} className="ml-auto mt-1" />
          </div>
        </header>

        <section className="grid grid-cols-2 gap-x-6 gap-y-0.5 border-b py-3">
          <p>
            <span className="text-gray-500">Patient:</span> <span className="font-semibold">{order.patient.name}</span>
          </p>
          <p>
            <span className="text-gray-500">Order no:</span> <span className="font-mono">{order.orderNo}</span>
          </p>
          <p>
            <span className="text-gray-500">Age / Sex:</span> {ageFromDob(order.patient.dateOfBirth) || '—'} / {order.patient.gender}
          </p>
          <p>
            <span className="text-gray-500">Collected:</span> {formatDateTime(firstCollected)}
          </p>
          <p>
            <span className="text-gray-500">UHID:</span> <span className="font-mono">{order.patient.uhid}</span>
          </p>
          <p>
            <span className="text-gray-500">Reported:</span> {final ? formatDateTime(order.verifiedAt) : 'Pending'}
          </p>
          <p>
            <span className="text-gray-500">Referred by:</span> {order.doctorName ?? order.referredBy ?? 'Self'}
          </p>
        </section>

        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-gray-600">
              <th className="py-1.5 font-semibold">Test</th>
              <th className="py-1.5 font-semibold">Result</th>
              <th className="py-1.5 font-semibold">Unit</th>
              <th className="py-1.5 font-semibold">Reference range</th>
            </tr>
          </thead>
          <tbody>
            {groupBySection(shown).map((g) => (
              <React.Fragment key={g.section}>
                <tr>
                  <td colSpan={4} className="pb-1 pt-3 text-xs font-bold uppercase tracking-wide">
                    {L.SECTION_LABELS[g.section]}
                  </td>
                </tr>
                {g.results.map((r, i) => {
                  const showPanel = r.panelName && g.results[i - 1]?.panelName !== r.panelName;
                  const abnormal = r.flag && r.flag !== 'normal';
                  return (
                    <React.Fragment key={r.id}>
                      {showPanel && (
                        <tr>
                          <td colSpan={4} className="pt-1 font-semibold underline">
                            {r.panelName}
                          </td>
                        </tr>
                      )}
                      <tr className="align-top">
                        <td className={`py-1 ${r.panelName ? 'pl-3' : ''}`}>
                          {r.name}
                          {r.method && <div className="text-[11px] text-gray-500">Method: {r.method}</div>}
                          {r.remarks && <div className="text-[11px] italic">{r.remarks}</div>}
                        </td>
                        <td className={`py-1 ${abnormal ? 'font-bold' : ''}`}>
                          {r.value}
                          {abnormal && <span className="ml-1">{FLAG_LABELS[r.flag!]}</span>}
                        </td>
                        <td className="py-1">{r.unit}</td>
                        <td className="py-1">{rangeText(r)}</td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="py-6 text-center text-gray-500">No results yet.</p>}

        <p className="mt-4 text-[11px] text-gray-500">L = low, H = high, LL / HH = critical. Results relate only to the sample tested; interpret with clinical findings.</p>

        <footer className="mt-10 flex items-end justify-between">
          <p className="text-[11px] text-gray-500">{hospital.footerNote}</p>
          <div className="text-center">
            <p className="font-semibold">{final ? (order.verifiedByName ?? '') : ''}</p>
            <p className="border-t pt-1 text-xs">Verified by (Pathologist / Lab in-charge)</p>
          </div>
        </footer>
        <p className="mt-6 text-center text-[11px] text-gray-500">— End of report —</p>
      </div>
    </>
  );
}
