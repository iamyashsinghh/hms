'use client';

import * as React from 'react';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2, UserCheck, UserX } from 'lucide-react';
import type { setup } from '@hms/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth, usePermission } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { BackLink, ErrorBox, Field, S, StatusBadge, SuccessBox, TemporaryPassword, titleCase } from '@/modules/setup/ui';
import { RoleAssignments, type Assignment } from '@/modules/setup/role-assignments';

function useMasters(enabled: boolean) {
  const roles = useQuery({ queryKey: ['setup', 'roles'], queryFn: () => api.setup.listRoles(), enabled });
  const facilities = useQuery({ queryKey: ['setup', 'facilities'], queryFn: () => api.setup.listFacilities(), enabled });
  return { roles: roles.data ?? [], facilities: facilities.data ?? [] };
}

const cleanAssignments = (a: Assignment[]) => a.filter((x) => x.roleId).map((x) => ({ roleId: x.roleId, facilityId: x.facilityId }));

function NewUser() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { roles, facilities } = useMasters(true);
  const departments = useQuery({ queryKey: ['setup', 'departments'], queryFn: () => api.setup.listDepartments() });
  const [form, setForm] = React.useState({ name: '', email: '', mobile: '', password: '', staffType: '' as '' | setup.UpsertStaffProfile['staffType'], departmentId: '', consultationFee: '' });
  const [assignments, setAssignments] = React.useState<Assignment[]>([{ roleId: '', facilityId: null }]);
  const [created, setCreated] = React.useState<setup.UserWithTemporaryPassword | null>(null);

  const doctorRole = roles.find((r) => r.key === 'doctor')?.id;
  const isDoctor = assignments.some((a) => a.roleId && a.roleId === doctorRole);
  // Picking the Doctor role pre-selects a doctor profile unless the admin chose another type.
  const staffType = form.staffType || (isDoctor ? 'doctor' : '');

  const create = useMutation({
    mutationFn: async () => {
      const body = S.createUserSchema.parse({
        name: form.name,
        email: form.email || undefined,
        mobile: form.mobile || undefined,
        password: form.password || undefined,
        roles: cleanAssignments(assignments),
        staffProfile: staffType
          ? {
              staffType,
              departmentId: form.departmentId || null,
              consultationFee: form.consultationFee ? Number(form.consultationFee) : undefined,
            }
          : undefined,
      });
      return api.setup.createUser(body);
    },
    onSuccess: (u) => {
      queryClient.invalidateQueries({ queryKey: ['setup'] });
      if (u.temporaryPassword) setCreated(u);
      else router.push(`/setup/users/${u.id}`);
    },
  });


  if (created) {
    return (
      <div className="max-w-2xl space-y-4">
        <BackLink href="/setup/users" label="All users" />
        <PageHeader title="User created" />
        <TemporaryPassword name={created.name} password={created.temporaryPassword!} delivery={created.delivery} />
        <p className="text-sm text-muted-foreground">
          They sign in with hospital code, their {created.email ? 'email' : 'mobile number'} and this password.
        </p>
        <div className="flex gap-2">
          <Button onClick={() => router.push(`/setup/users/${created.id}`)}>Open user</Button>
          <Button
            variant="outline"
            onClick={() => {
              setCreated(null);
              setForm({ name: '', email: '', mobile: '', password: '', staffType: '', departmentId: '', consultationFee: '' });
              setAssignments([{ roleId: '', facilityId: null }]);
            }}
          >
            Add another
          </Button>
        </div>
      </div>
    );
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="max-w-3xl">
      <BackLink href="/setup/users" label="All users" />
      <PageHeader title="Add user" description="Leave the password empty to get a temporary one to hand over." />
      <form
        noValidate
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <ErrorBox error={create.error} />
        <Card>
          <CardHeader>
            <CardTitle>Login</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <Field id="name" label="Full name *" className="sm:col-span-2">
              <Input id="name" value={form.name} onChange={set('name')} />
            </Field>
            <Field id="email" label="Email" hint="Email or mobile is needed to sign in">
              <Input id="email" type="email" value={form.email} onChange={set('email')} />
            </Field>
            <Field id="mobile" label="Mobile">
              <Input id="mobile" type="tel" inputMode="numeric" value={form.mobile} onChange={set('mobile')} />
            </Field>
            <Field id="password" label="Password" hint="At least 8 characters with a letter and a digit">
              <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Roles</CardTitle>
            <CardDescription>A role can apply to all facilities or to one branch.</CardDescription>
          </CardHeader>
          <CardContent>
            <RoleAssignments value={assignments} onChange={setAssignments} roles={roles} facilities={facilities} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Staff profile (optional)</CardTitle>
            <CardDescription>You can fill more details later under Staff profiles.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-3">
            <Field id="staffType" label="Staff type">
              <Select id="staffType" value={staffType} onChange={set('staffType')}>
                <option value="">—</option>
                {S.STAFF_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {titleCase(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="departmentId" label="Department">
              <Select id="departmentId" value={form.departmentId} onChange={set('departmentId')} disabled={!staffType}>
                <option value="">—</option>
                {departments.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            {staffType === 'doctor' && (
              <Field id="consultationFee" label="Consultation fee (₹)">
                <Input id="consultationFee" type="number" min={0} value={form.consultationFee} onChange={set('consultationFee')} />
              </Field>
            )}
          </CardContent>
        </Card>
        <div className="flex justify-end">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending && <Loader2 className="animate-spin" />}
            Create user
          </Button>
        </div>
      </form>
    </div>
  );
}

function EditUser({ id }: { id: string }) {
  const { data: u, isPending, error } = useQuery({ queryKey: ['setup', 'users', id], queryFn: () => api.setup.getUser(id) });
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  return <EditUserForm u={u} />;
}

function EditUserForm({ u }: { u: setup.StaffUser }) {
  const id = u.id;
  const queryClient = useQueryClient();
  const { user: me } = useAuth();
  const canManage = usePermission('core.user.manage');
  const { roles, facilities } = useMasters(true);
  const [details, setDetails] = React.useState({ name: u.name, email: u.email ?? '', mobile: u.mobile ?? '' });
  const [assignments, setAssignments] = React.useState<Assignment[]>(() => u.roles.map((r) => ({ roleId: r.roleId, facilityId: r.facilityId })));
  const [temp, setTemp] = React.useState<setup.ResetPasswordResult | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);

  const onSaved = (msg: string) => (next: setup.StaffUser) => {
    queryClient.setQueryData(['setup', 'users', id], next);
    queryClient.invalidateQueries({ queryKey: ['setup', 'users'], exact: false });
    setSaved(msg);
  };
  const update = useMutation({
    mutationFn: async () =>
      api.setup.updateUser(id, S.updateUserSchema.parse({ name: details.name, email: details.email || null, mobile: details.mobile || null })),
    onSuccess: onSaved('Details saved.'),
  });
  const setRoles = useMutation({ mutationFn: () => api.setup.setUserRoles(id, { roles: cleanAssignments(assignments) }), onSuccess: onSaved('Roles saved.') });
  const toggle = useMutation({
    mutationFn: () => (u?.status === 'disabled' ? api.setup.activateUser(id) : api.setup.deactivateUser(id)),
    onSuccess: (next) => onSaved(next.status === 'disabled' ? 'User deactivated and signed out.' : 'User activated.')(next),
  });
  const reset = useMutation({
    mutationFn: () => api.setup.resetPassword(id),
    onSuccess: (r) => {
      setTemp(r.temporaryPassword ? r : null);
      setSaved(null);
    },
  });

  const self = me?.id === u.id;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <BackLink href="/setup/users" label="All users" />
        <PageHeader
          title={u.name}
          description={
            <span className="flex items-center gap-2">
              <StatusBadge status={u.status} /> Added {formatDate(u.createdAt)} · Last login {u.lastLoginAt ? formatDate(u.lastLoginAt) : 'never'}
            </span>
          }
        />
      </div>
      {saved && <SuccessBox>{saved}</SuccessBox>}
      {temp && <TemporaryPassword name={u.name} password={temp.temporaryPassword!} delivery={temp.delivery} />}
      <ErrorBox error={update.error ?? setRoles.error ?? toggle.error ?? reset.error} />

      <fieldset disabled={!canManage} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <Field id="name" label="Full name" className="sm:col-span-2">
              <Input id="name" value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} />
            </Field>
            <Field id="email" label="Email">
              <Input id="email" type="email" value={details.email} onChange={(e) => setDetails({ ...details, email: e.target.value })} />
            </Field>
            <Field id="mobile" label="Mobile">
              <Input id="mobile" value={details.mobile} onChange={(e) => setDetails({ ...details, mobile: e.target.value })} />
            </Field>
            <div className="sm:col-span-2 flex justify-end">
              <Button onClick={() => update.mutate()} disabled={update.isPending}>
                {update.isPending && <Loader2 className="animate-spin" />}
                Save details
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Roles</CardTitle>
            <CardDescription>Changes apply on the user&apos;s next action; no need to sign out.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <RoleAssignments value={assignments} onChange={setAssignments} roles={roles} facilities={facilities} />
            <div className="flex justify-end">
              <Button onClick={() => setRoles.mutate()} disabled={setRoles.isPending || cleanAssignments(assignments).length === 0}>
                {setRoles.isPending && <Loader2 className="animate-spin" />}
                Save roles
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Access</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => reset.mutate()} disabled={reset.isPending}>
              <KeyRound /> Reset password
            </Button>
            {!self && (
              <Button
                variant={u.status === 'disabled' ? 'default' : 'destructive'}
                onClick={() => {
                  if (u.status === 'disabled' || confirm(`Deactivate ${u.name}? They will be signed out everywhere.`)) toggle.mutate();
                }}
                disabled={toggle.isPending}
              >
                {u.status === 'disabled' ? <UserCheck /> : <UserX />}
                {u.status === 'disabled' ? 'Activate' : 'Deactivate'}
              </Button>
            )}
          </CardContent>
        </Card>
      </fieldset>
    </div>
  );
}

export default function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = usePermission('core.user.read');
  const canManage = usePermission('core.user.manage');
  if (id === 'new') return canManage ? <NewUser /> : <NoAccess />;
  return canRead ? <EditUser id={id} /> : <NoAccess />;
}
