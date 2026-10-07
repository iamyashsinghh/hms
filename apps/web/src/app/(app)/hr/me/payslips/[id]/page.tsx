'use client';

import Link from 'next/link';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { PayslipView } from '@/modules/hr/payslip';

export default function MyPayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canUse = usePermission('hr.self.use');
  const { data, isPending, error } = useQuery({ queryKey: ['hr', 'me', 'payslips', id], queryFn: () => api.hr.me.payslip(id), enabled: canUse });
  if (!canUse) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  return (
    <>
      <div className="mb-4 flex justify-between print:hidden">
        <Link href="/hr/me" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          <ArrowLeft /> My HR
        </Link>
        <Button onClick={() => window.print()}>
          <Printer /> Print
        </Button>
      </div>
      <PayslipView slip={data} />
    </>
  );
}
