'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import type { hr as H, setup as S } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { buttonVariants } from '@/components/ui/button';
import { EmployeeForm, emptyEmployee, toBody, type EmployeeFormValues } from '@/modules/hr/employee-form';

const COUNCIL_LICENCE: Partial<Record<string, H.LicenceKind>> = {
  doctor: 'medical_registration',
  nurse: 'nursing_registration',
  pharmacist: 'pharmacy_registration',
  technician: 'paramedical_registration',
};

export default function NewEmployeePage() {
  const canManage = usePermission('hr.employee.manage');
  const canPay = usePermission('hr.payroll.manage');
  const router = useRouter();
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: async ({ f, staff }: { f: EmployeeFormValues; staff: S.StaffMember | null }) => {
      const body = toBody(f, canPay);
      const emp = await api.hr.employees.create({ ...body, fullName: f.fullName, dateOfJoining: f.dateOfJoining, employeeCode: f.employeeCode || undefined });
      // Carry the council registration from the Setup profile into licence tracking.
      const reg = staff?.profile?.registrationNo;
      const kind = COUNCIL_LICENCE[f.category];
      if (reg && kind) {
        await api.hr.licences.add(emp.id, { kind, number: reg, issuedBy: staff?.profile?.registrationCouncil ?? null }).catch(() => undefined);
      }
      return emp;
    },
    onSuccess: (emp) => {
      queryClient.invalidateQueries({ queryKey: ['hr'] });
      router.push(`/hr/employees/${emp.id}`);
    },
  });

  if (!canManage) return <NoAccess />;
  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/hr/employees" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-3 mb-2' })}>
        <ArrowLeft /> Employees
      </Link>
      <PageHeader title="Add employee" description="Copy a staff login from Setup, or add support staff who don't log in." />
      <EmployeeForm
        initial={emptyEmployee()}
        isNew
        saving={save.isPending}
        error={save.error ? errorMessage(save.error) : null}
        onSubmit={(f, staff) => save.mutate({ f, staff })}
        onCancel={() => router.push('/hr/employees')}
      />
    </div>
  );
}
