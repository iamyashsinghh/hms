'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { insurance as I } from '@hms/shared';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PatientPolicyPicker } from '@/modules/insurance/policy-select';
import { PreauthForm } from '@/modules/insurance/preauth-form';

export default function Page() {
  return (
    <React.Suspense>
      <NewPreauthPage />
    </React.Suspense>
  );
}

function NewPreauthPage() {
  const canManage = usePermission('insurance.preauth.manage');
  const params = useSearchParams();
  const [policy, setPolicy] = React.useState<I.Policy | null>(null);

  if (!canManage) return <NoAccess />;

  return (
    <>
      <Link href="/insurance/preauths" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> Pre-auths
      </Link>
      <PageHeader title="New pre-authorisation" description="Saved as a draft; submit it to the payer from the next screen." />
      <Card>
        <CardContent className="space-y-4 pt-6">
          <PatientPolicyPicker presetPolicyId={params.get('policyId')} value={policy} onChange={setPolicy} />
          {policy ? <PreauthForm key={policy.id} policy={policy} /> : <p className="text-sm text-muted-foreground">Pick the patient and policy to continue.</p>}
        </CardContent>
      </Card>
    </>
  );
}
