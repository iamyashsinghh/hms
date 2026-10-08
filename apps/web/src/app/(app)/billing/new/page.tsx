'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, FilePlus2 } from 'lucide-react';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { buttonVariants } from '@/components/ui/button';
import { BillPatient, BillPatientStart } from '@/modules/billing/bill-patient';

export default function Page() {
  return (
    <React.Suspense>
      <BillAPatientPage />
    </React.Suspense>
  );
}

/** Bill a patient: other screens link here with ?patientId=. */
function BillAPatientPage() {
  const canCreate = usePermission('billing.invoice.create');
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const patientId = params.get('patientId');
  const setPatient = (id: string | null) => router.replace(id ? `${pathname}?patientId=${id}` : pathname);

  if (!canCreate) return <NoAccess />;

  return (
    <div className="max-w-6xl">
      <Link href="/billing" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> All bills
      </Link>
      <PageHeader
        title="Bill a patient"
        description="Everything the departments charged is already here. Untick what the patient will pay later, add anything missing, and collect."
        actions={
          <Link href={patientId ? `/billing/new/manual?patientId=${patientId}` : '/billing/new/manual'} className={buttonVariants({ variant: 'outline' })}>
            <FilePlus2 /> Bill without charges
          </Link>
        }
      />
      {patientId ? <BillPatient key={patientId} patientId={patientId} onChangePatient={() => setPatient(null)} /> : <BillPatientStart onPick={setPatient} />}
    </div>
  );
}
