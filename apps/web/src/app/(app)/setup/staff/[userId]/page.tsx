'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Loader2 } from 'lucide-react';
import { todayIso, type setup } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { BackLink, ErrorBox, Field, S, SuccessBox, optNull, optNumber, opt, titleCase } from '@/modules/setup/ui';

export default function StaffProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const canRead = usePermission('setup.staff.read');
  const canManage = usePermission('setup.staff.manage');
  const queryClient = useQueryClient();
  const staff = useQuery({ queryKey: ['setup', 'staff', userId], queryFn: () => api.setup.getStaff(userId), enabled: canRead });
  const departments = useQuery({ queryKey: ['setup', 'departments'], queryFn: () => api.setup.listDepartments(), enabled: canRead });
  const specializations = useQuery({ queryKey: ['setup', 'specializations'], queryFn: () => api.setup.listSpecializations(), enabled: canRead });

  const { register, handleSubmit, reset, watch, formState } = useForm({
    resolver: zodResolver(S.upsertStaffProfileSchema),
    defaultValues: { staffType: 'other' as const },
  });
  const { errors } = formState;
  const staffType = watch('staffType');

  React.useEffect(() => {
    const p = staff.data?.profile;
    if (!p) {
      if (staff.data?.roles.includes('doctor')) reset({ staffType: 'doctor' });
      return;
    }
    const v = Object.fromEntries(Object.entries(p).filter(([, x]) => x !== null)) as Record<string, unknown>;
    delete v.departmentName;
    delete v.specializationName;
    reset(v as setup.UpsertStaffProfile);
  }, [staff.data, reset]);

  const save = useMutation({
    mutationFn: (body: setup.UpsertStaffProfile) => api.setup.saveStaffProfile(userId, body),
    onSuccess: (s) => {
      queryClient.setQueryData(['setup', 'staff', userId], s);
      queryClient.invalidateQueries({ queryKey: ['setup'] });
    },
  });

  if (!canRead) return <NoAccess />;
  if (staff.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (staff.error) return <p className="text-sm text-destructive">{errorMessage(staff.error)}</p>;

  return (
    <div className="max-w-4xl">
      <BackLink href="/setup/staff" label="All staff" />
      <PageHeader
        title={staff.data.name}
        description={[staff.data.email, staff.data.mobile].filter(Boolean).join(' · ')}
        actions={
          staffType === 'doctor' && staff.data.profile ? (
            <Link href={`/setup/doctors/${userId}`} className={buttonVariants({ variant: 'outline' })}>
              <CalendarClock /> OPD timings
            </Link>
          ) : null
        }
      />
      <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="space-y-6">
        <ErrorBox error={save.error} />
        {save.isSuccess && !formState.isDirty && <SuccessBox>Profile saved.</SuccessBox>}
        <fieldset disabled={!canManage} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Employment</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-3">
              <Field id="staffType" label="Staff type *" error={errors.staffType}>
                <Select id="staffType" {...register('staffType')}>
                  {S.STAFF_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {titleCase(t)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="employeeCode" label="Employee code" error={errors.employeeCode}>
                <Input id="employeeCode" {...register('employeeCode', opt)} />
              </Field>
              <Field id="designation" label="Designation" error={errors.designation}>
                <Input id="designation" placeholder="e.g. Senior Consultant" {...register('designation', opt)} />
              </Field>
              <Field id="departmentId" label="Department" error={errors.departmentId}>
                <Select id="departmentId" {...register('departmentId', optNull)}>
                  <option value="">—</option>
                  {departments.data?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="gender" label="Gender" error={errors.gender}>
                <Select id="gender" {...register('gender', opt)}>
                  <option value="">—</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </Select>
              </Field>
              <Field id="dateOfJoining" label="Date of joining" error={errors.dateOfJoining}>
                <Input id="dateOfJoining" type="date" min="1950-01-01" max={todayIso(366)} {...register('dateOfJoining', opt)} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Qualification &amp; registration</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-3">
              <Field id="qualification" label="Qualification" error={errors.qualification}>
                <Input id="qualification" placeholder="e.g. MBBS, MD" {...register('qualification', opt)} />
              </Field>
              <Field id="registrationNo" label="Council registration no" error={errors.registrationNo}>
                <Input id="registrationNo" {...register('registrationNo', opt)} />
              </Field>
              <Field id="registrationCouncil" label="Council" error={errors.registrationCouncil}>
                <Input id="registrationCouncil" placeholder="e.g. Maharashtra Medical Council" {...register('registrationCouncil', opt)} />
              </Field>
              {staffType === 'doctor' && (
                <Field id="specializationId" label="Specialization" error={errors.specializationId}>
                  <Select id="specializationId" {...register('specializationId', optNull)}>
                    <option value="">—</option>
                    {specializations.data?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field id="signatureUrl" label="Signature image URL" error={errors.signatureUrl} className="sm:col-span-2">
                <Input id="signatureUrl" placeholder="https://" {...register('signatureUrl', opt)} />
              </Field>
            </CardContent>
          </Card>

          {staffType === 'doctor' && (
            <Card>
              <CardHeader>
                <CardTitle>OPD fees</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-5 sm:grid-cols-3">
                <Field id="consultationFee" label="Consultation fee (₹)" error={errors.consultationFee}>
                  <Input id="consultationFee" type="number" inputMode="decimal" min={0} max={10_000_000} step="0.01" {...register('consultationFee', optNumber)} />
                </Field>
                <Field id="followUpFee" label="Follow-up fee (₹)" error={errors.followUpFee}>
                  <Input id="followUpFee" type="number" inputMode="decimal" min={0} max={10_000_000} step="0.01" {...register('followUpFee', optNumber)} />
                </Field>
                <Field id="followUpDays" label="Follow-up valid for (days)" error={errors.followUpDays}>
                  <Input id="followUpDays" type="number" inputMode="numeric" min={0} max={365} step={1} {...register('followUpDays', optNumber)} />
                </Field>
              </CardContent>
            </Card>
          )}
        </fieldset>
        {canManage && (
          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              Save profile
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
