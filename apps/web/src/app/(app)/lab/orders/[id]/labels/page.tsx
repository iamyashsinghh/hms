'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Barcode } from '@/modules/lab/barcode';
import { ageFromDob, genderShort } from '@/modules/lab/ui';

/** Tube labels (50 × 25 mm), one per live sample. */
export default function SampleLabelsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('lab.order.read');
  const { data: order, error } = useQuery({ queryKey: ['lab', 'orders', id], queryFn: () => api.lab.orders.get(id), enabled: canRead });

  if (!canRead) return <NoAccess />;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  if (!order) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const samples = order.samples.filter((s) => s.status !== 'rejected' && s.testNames.length);

  return (
    <>
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #labels, #labels * { visibility: visible !important; }
        #labels { position: absolute; left: 0; top: 0; }
        .label { break-after: page; border: 0 !important; margin: 0 !important; }
        @page { size: 50mm 25mm; margin: 0; }
      }`}</style>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/lab/orders/${id}`} className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3' })}>
          <ArrowLeft /> Back to order
        </Link>
        <Button onClick={() => window.print()}>
          <Printer /> Print {samples.length} label{samples.length === 1 ? '' : 's'}
        </Button>
      </div>
      <div id="labels" className="flex flex-wrap gap-4">
        {samples.map((s) => (
          <div key={s.id} className="label flex h-[25mm] w-[50mm] flex-col justify-between overflow-hidden rounded border bg-white px-[2mm] py-[1mm] text-[8px] leading-tight text-black">
            <div className="flex justify-between font-semibold">
              <span className="truncate">{order.patient.name}</span>
              <span>
                {ageFromDob(order.patient.dateOfBirth)}/{genderShort(order.patient.gender)}
              </span>
            </div>
            <Barcode value={s.barcode} height={30} moduleWidth={0.9} className="mx-auto h-[10mm] w-full" />
            <div className="flex justify-between">
              <span className="font-mono font-semibold">{s.barcode}</span>
              <span className="capitalize">{s.sampleType}</span>
            </div>
            <div className="truncate">
              {order.patient.uhid} · {s.testNames.join(', ')}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
