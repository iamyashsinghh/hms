'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, UserPlus } from 'lucide-react';
import { GENDERS, portal } from '@hms/shared';
import { errorMessage } from '@/lib/api';
import { FieldError } from '@/components/field-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { patientApi } from '../patient-session';
import { patientName } from './shared';

export function FamilyTab({ patients, onChanged }: { patients: portal.PortalPatient[]; onChanged: () => Promise<void> }) {
  const [adding, setAdding] = React.useState(patients.length === 0);
  return (
    <div className="space-y-4">
      {patients.map((p) => (
        <Card key={p.id}>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-secondary font-semibold text-primary">{p.firstName[0]?.toUpperCase()}</div>
              <div>
                <p className="font-medium">{patientName(p)}</p>
                <p className="text-sm capitalize text-muted-foreground">
                  {p.relation} · {p.gender}
                  {p.bloodGroup ? ` · ${p.bloodGroup}` : ''}
                </p>
              </div>
            </div>
            <Badge variant="outline" className="font-mono">
              {p.uhid}
            </Badge>
          </CardContent>
        </Card>
      ))}
      {adding ? (
        <AddMember first={patients.length === 0} onDone={async () => { await onChanged(); setAdding(false); }} />
      ) : (
        <Button variant="outline" onClick={() => setAdding(true)}>
          <UserPlus /> Add family member
        </Button>
      )}
    </div>
  );
}

type FormValues = {
  firstName: string;
  lastName?: string;
  gender: (typeof GENDERS)[number];
  dateOfBirth?: string;
  ageYears?: number;
  relation: portal.Relation;
};

function AddMember({ first, onDone }: { first: boolean; onDone: () => Promise<void> }) {
  const [error, setError] = React.useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(portal.addFamilyMemberSchema) as never,
    defaultValues: { firstName: '', gender: 'female', relation: first ? 'self' : 'child' },
  });
  const { errors, isSubmitting } = formState;

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await patientApi.portal.addFamilyMember({ ...v, lastName: v.lastName || undefined, dateOfBirth: v.dateOfBirth || undefined });
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{first ? 'Register yourself' : 'Add a family member'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <div className="space-y-2">
            <Label htmlFor="fm-first">First name</Label>
            <Input id="fm-first" {...register('firstName')} aria-invalid={!!errors.firstName} />
            <FieldError error={errors.firstName} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fm-last">Last name</Label>
            <Input id="fm-last" {...register('lastName')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fm-gender">Gender</Label>
            <Select id="fm-gender" {...register('gender')}>
              {GENDERS.map((g) => (
                <option key={g} value={g} className="capitalize">
                  {g}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fm-rel">Relation</Label>
            <Select id="fm-rel" {...register('relation')}>
              {portal.RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {r === 'self' ? 'Myself' : r[0]!.toUpperCase() + r.slice(1)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fm-dob">Date of birth</Label>
            <Input id="fm-dob" type="date" {...register('dateOfBirth')} />
            <FieldError error={errors.dateOfBirth} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fm-age">or age in years</Label>
            <Input id="fm-age" type="number" min={0} max={150} {...register('ageYears', { setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)) })} />
          </div>
          {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" />} Save
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
