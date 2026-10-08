'use client';

import * as React from 'react';
import Link from 'next/link';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PREAUTH_EDITABLE, PreauthForm } from '@/modules/insurance/preauth-form';
import { statusLabel } from '@/modules/insurance/ui';

export default function EditPreauthPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canManage = usePermission('insurance.preauth.manage');
  const router = useRouter();
  const { data: pa, isPending, error } = useQuery({ queryKey: ['insurance', 'preauths', id], queryFn: () => api.insurance.preauths.get(id), enabled: canManage });

  if (!canManage) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;

  return (
    <>
      <Link href={`/insurance/preauths/${id}`} className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> Pre-auth {pa.number}
      </Link>
      <PageHeader
        title={`Edit pre-auth ${pa.number}`}
        description={`${pa.patientName} · ${pa.payerName} · policy ${pa.policy.policyNumber}. Editable while it is a draft or under query.`}
      />
      <Card>
        <CardContent className="pt-6">
          {PREAUTH_EDITABLE.includes(pa.status) ? (
            <PreauthForm key={pa.id} policy={pa.policy} preauth={pa} onCancel={() => router.push(`/insurance/preauths/${id}`)} />
          ) : (
            <p className="text-sm text-muted-foreground">This pre-auth is {statusLabel(pa.status).toLowerCase()} and can no longer be edited.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
