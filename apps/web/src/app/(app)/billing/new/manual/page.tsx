'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { Patient } from '@hms/shared';
import { api } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { buttonVariants } from '@/components/ui/button';
import { BillForm } from '@/modules/billing/bill-form';

export default function Page() {
  return (
    <React.Suspense>
      <NewBillPage />
    </React.Suspense>
  );
}

function NewBillPage() {
  const canCreate = usePermission('billing.invoice.create');
  const params = useSearchParams();
  const [patient, setPatient] = React.useState<Patient | null>(null);

  const presetPatient = params.get('patientId');
  React.useEffect(() => {
    if (presetPatient) api.patients.get(presetPatient).then(setPatient).catch(() => undefined);
  }, [presetPatient]);

  if (!canCreate) return <NoAccess />;

  return (
    <div className="max-w-5xl">
      <Link href={presetPatient ? `/billing/new?patientId=${presetPatient}` : '/billing/new'} className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> Bill a patient
      </Link>
      <PageHeader
        title="Bill without charges"
        description="A bill typed line by line, without the charges departments posted. Pick services from the master; leave the price blank to use the price list. It can be saved as a draft."
      />
      {/* Remounts once a ?patientId= patient has loaded so the form starts with them picked. */}
      <BillForm key={patient?.id ?? 'none'} presetPatient={patient} />
    </div>
  );
}
