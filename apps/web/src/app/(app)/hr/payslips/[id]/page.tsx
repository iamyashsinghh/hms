'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { PayslipView } from '@/modules/hr/payslip';

export default function PayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('hr.payroll.read');
  const router = useRouter();
  const { data, isPending, error } = useQuery({ queryKey: ['hr', 'payslips', id], queryFn: () => api.hr.payroll.payslip(id), enabled: canRead });
  if (!canRead) return <NoAccess />;
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  return (
    <>
      <div className="mb-4 flex justify-between print:hidden">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft /> Back
        </Button>
        <Button onClick={() => window.print()}>
          <Printer /> Print
        </Button>
      </div>
      <PayslipView slip={data} />
    </>
  );
}
