'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { GENDERS, createPatientSchema, type CreatePatient, type Patient, frontoffice as fo } from '@hms/shared';
import { api } from '@/lib/api';
import { Can, usePermission } from '@/lib/auth';
import { genderLabel } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { NoAccess } from '@/components/no-access';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DoctorSelect, ErrorBox, PatientPicker, useDebounced } from '@/modules/frontoffice/ui';

type Form = {
  firstName: string;
  lastName: string;
  gender: (typeof GENDERS)[number];
  dateOfBirth: string;
  ageYears: string;
  mobile: string;
  abhaNumber: string;
  city: string;
};
const EMPTY: Form = { firstName: '', lastName: '', gender: 'male', dateOfBirth: '', ageYears: '', mobile: '', abhaNumber: '', city: '' };

export default function FrontDeskRegisterPage() {
  const canCreate = usePermission('core.patient.create');
  const canDedupe = usePermission('frontoffice.patient.dedupe');
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<Form>(EMPTY);
  const [created, setCreated] = React.useState<Patient | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setConfirmed(false);
  };

  const probe = useDebounced(
    {
      firstName: form.firstName.trim() || undefined,
      lastName: form.lastName.trim() || undefined,
      mobile: form.mobile.trim().length >= 10 ? form.mobile.trim() : undefined,
      dateOfBirth: form.dateOfBirth || undefined,
      abhaNumber: form.abhaNumber.replace(/[-\s]/g, '').length === 14 ? form.abhaNumber.replace(/[-\s]/g, '') : undefined,
    },
    400,
  );
  const hasProbe = (probe.firstName?.length ?? 0) >= 2 || !!probe.mobile || !!probe.abhaNumber;
  const dupes = useQuery({
    queryKey: ['frontoffice', 'duplicates', probe],
    queryFn: () => api.frontoffice.patients.duplicates(probe),
    enabled: canDedupe && hasProbe && !created,
  });
  const strong = (dupes.data ?? []).filter((d) => d.score >= 60);

  const create = useMutation({
    mutationFn: () => {
      const body: CreatePatient = createPatientSchema.parse({
        firstName: form.firstName,
        lastName: form.lastName || undefined,
        gender: form.gender,
        dateOfBirth: form.dateOfBirth || undefined,
        ageYears: !form.dateOfBirth && form.ageYears ? Number(form.ageYears) : undefined,
        mobile: form.mobile || undefined,
        abhaNumber: form.abhaNumber ? form.abhaNumber.replace(/[-\s]/g, '') : undefined,
        address: form.city ? { city: form.city } : undefined,
      });
      return api.patients.create(body);
    },
    onSuccess: (p) => {
      setCreated(p);
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });

  if (!canCreate) return <NoAccess />;

  if (created) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Patient registered" />
        <Card className="mb-6">
          <CardContent className="flex items-center gap-4 pt-6">
            <CheckCircle2 className="size-10 text-primary" />
            <div>
              <div className="text-lg font-semibold">
                {created.firstName} {created.lastName}
              </div>
              <div className="font-mono text-sm text-muted-foreground">UHID {created.uhid}</div>
            </div>
          </CardContent>
        </Card>
        <QuickToken patient={created} />
        <div className="mt-6 flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setCreated(null);
              setForm(EMPTY);
            }}
          >
            Register another
          </Button>
          <Link href="/frontoffice/appointments" className={buttonVariants({ variant: 'outline' })}>
            Book an appointment
          </Link>
          <Link href={`/patients/${created.id}`} className={buttonVariants({ variant: 'ghost' })}>
            Open patient
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Front desk registration" description="Quick registration with a live duplicate check, then a token in one step." />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
            <div>
              <Label htmlFor="firstName">First name *</Label>
              <Input id="firstName" className="mt-1" value={form.firstName} onChange={set('firstName')} autoFocus />
            </div>
            <div>
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" className="mt-1" value={form.lastName} onChange={set('lastName')} />
            </div>
            <div>
              <Label htmlFor="gender">Gender *</Label>
              <Select id="gender" className="mt-1" value={form.gender} onChange={set('gender')}>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {genderLabel(g)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="mobile">Mobile</Label>
              <Input id="mobile" type="tel" inputMode="numeric" className="mt-1" placeholder="10 digits" value={form.mobile} onChange={set('mobile')} />
            </div>
            <div>
              <Label htmlFor="dob">Date of birth</Label>
              <Input id="dob" type="date" className="mt-1" value={form.dateOfBirth} onChange={set('dateOfBirth')} />
            </div>
            <div>
              <Label htmlFor="age">Age (if DOB unknown)</Label>
              <Input id="age" type="number" min={0} max={150} className="mt-1" value={form.ageYears} onChange={set('ageYears')} disabled={!!form.dateOfBirth} />
            </div>
            <div>
              <Label htmlFor="abha">ABHA number</Label>
              <Input id="abha" inputMode="numeric" className="mt-1" placeholder="14 digits, e.g. 91-1234-5678-9012" value={form.abhaNumber} onChange={set('abhaNumber')} />
            </div>
            <div>
              <Label htmlFor="city">City</Label>
              <Input id="city" className="mt-1" value={form.city} onChange={set('city')} />
            </div>
            <div className="sm:col-span-2">
              <ErrorBox error={create.error} />
            </div>
            {strong.length > 0 && (
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                I checked the possible matches and this is a different person.
              </label>
            )}
            <div className="flex justify-end sm:col-span-2">
              <Button disabled={!form.firstName.trim() || create.isPending || (strong.length > 0 && !confirmed)} onClick={() => create.mutate()}>
                {create.isPending && <Loader2 className="animate-spin" />}
                Register patient
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Can permission="frontoffice.patient.dedupe">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Possible matches {dupes.isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                </CardTitle>
                <CardDescription>Checked by name, mobile, date of birth and ABHA as you type.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {!hasProbe ? (
                  <p className="text-sm text-muted-foreground">Start typing a name or mobile number.</p>
                ) : !dupes.data?.length ? (
                  <p className="text-sm text-muted-foreground">No existing patient looks like this.</p>
                ) : (
                  dupes.data.map((d) => <MatchRow key={d.patient.id} match={d} />)
                )}
              </CardContent>
            </Card>
            <AbhaCard />
          </Can>
        </div>
      </div>
    </>
  );
}

function MatchRow({ match }: { match: fo.DuplicateCandidate }) {
  const p = match.patient;
  return (
    <div className={`rounded-md border p-3 text-sm ${match.score >= 80 ? 'border-destructive/40 bg-destructive/5' : ''}`}>
      <div className="flex items-center justify-between">
        <Link href={`/patients/${p.id}`} className="font-medium text-primary hover:underline">
          {p.name}
        </Link>
        <Badge variant={match.score >= 80 ? 'destructive' : match.score >= 60 ? 'accent' : 'outline'}>
          {match.score >= 80 && <AlertTriangle className="mr-1 size-3" />}
          {match.score}%
        </Badge>
      </div>
      <div className="text-xs text-muted-foreground">
        <span className="font-mono">{p.uhid}</span> · {genderLabel(p.gender)} · {p.dateOfBirth ?? 'DOB —'} · {p.mobile ?? 'no mobile'}
      </div>
      <div className="mt-1 text-xs">{match.reasons.join(' · ')}</div>
    </div>
  );
}

/** Issue a walk-in token right after registration. */
function QuickToken({ patient }: { patient: Patient }) {
  const [doctorId, setDoctorId] = React.useState('');
  const walk = useMutation({ mutationFn: () => api.frontoffice.walkIn({ patientId: patient.id, doctorId }) });
  return (
    <Can permission="frontoffice.queue.manage">
      <Card>
        <CardHeader>
          <CardTitle>Give an OPD token now</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          {walk.data ? (
            <div className="text-center">
              <div className="text-xs text-muted-foreground">Token with {walk.data.doctorName}</div>
              <div className="text-5xl font-bold tabular-nums text-primary">{walk.data.tokenNo}</div>
            </div>
          ) : (
            <>
              <div className="w-64">
                <Label htmlFor="qt-doctor">Doctor</Label>
                <div className="mt-1">
                  <DoctorSelect id="qt-doctor" value={doctorId} onChange={setDoctorId} />
                </div>
              </div>
              <Button disabled={!doctorId || walk.isPending} onClick={() => walk.mutate()}>
                {walk.isPending && <Loader2 className="animate-spin" />}
                Issue token
              </Button>
              <div className="w-full">
                <ErrorBox error={walk.error} />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </Can>
  );
}

/** Capture an ABHA number for an existing patient. */
function AbhaCard() {
  const canUpdate = usePermission('core.patient.update');
  const [patient, setPatient] = React.useState<Patient | null>(null);
  const [abha, setAbha] = React.useState('');
  const [address, setAddress] = React.useState('');
  const save = useMutation({
    mutationFn: () => api.frontoffice.patients.captureAbha(patient!.id, { abhaNumber: abha, abhaAddress: address || undefined }),
    onSuccess: (p) => {
      setPatient(p);
      setAbha('');
      setAddress('');
    },
  });
  if (!canUpdate) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Link ABHA to existing patient</CardTitle>
        <CardDescription>Saved on the patient record; verification with ABDM comes with the integrations module.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <PatientPicker value={patient} onChange={setPatient} />
        {patient?.abhaNumber && <p className="text-xs text-muted-foreground">Current ABHA: {patient.abhaNumber}</p>}
        <Input placeholder="ABHA number (14 digits)" inputMode="numeric" value={abha} onChange={(e) => setAbha(e.target.value)} />
        <Input placeholder="ABHA address, e.g. name@abdm (optional)" value={address} onChange={(e) => setAddress(e.target.value)} />
        <ErrorBox error={save.error} />
        {save.isSuccess && <p className="text-xs text-primary">ABHA saved.</p>}
        <Button className="w-full" disabled={!patient || abha.replace(/\D/g, '').length !== 14 || save.isPending} onClick={() => save.mutate()}>
          Save ABHA
        </Button>
      </CardContent>
    </Card>
  );
}
