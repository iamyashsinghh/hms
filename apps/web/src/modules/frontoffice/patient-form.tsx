'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { GENDERS, createPatientSchema, type CreatePatient, type Patient } from '@hms/shared';
import { api } from '@/lib/api';
import { usePermission } from '@/lib/auth';
import { genderLabel } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorBox, isValidDate, istToday, longDate, useDebounced } from './ui';

/** The quick-registration fields the front desk fills in, as typed. */
export type PatientForm = {
  firstName: string;
  lastName: string;
  gender: (typeof GENDERS)[number];
  dateOfBirth: string;
  ageYears: string;
  mobile: string;
  abhaNumber: string;
  city: string;
};
export const EMPTY_PATIENT_FORM: PatientForm = {
  firstName: '',
  lastName: '',
  gender: 'male',
  dateOfBirth: '',
  ageYears: '',
  mobile: '',
  abhaNumber: '',
  city: '',
};

const NAME = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;
/** Accepts "98765 43210", "+91 98765-43210" and "098765..." and keeps the 10 digits. */
export const cleanMobile = (m: string) =>
  m.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '');
export const cleanAbha = (a: string) => a.replace(/[-\s]/g, '');

/** Field errors for the form; an empty object means it can be saved. */
export function validatePatientForm(f: PatientForm): Partial<Record<keyof PatientForm, string>> {
  const e: Partial<Record<keyof PatientForm, string>> = {};
  const first = f.firstName.trim();
  if (!first) e.firstName = 'First name is required';
  else if (first.length > 100) e.firstName = 'Keep it under 100 characters';
  else if (!NAME.test(first)) e.firstName = 'Use letters only';
  const last = f.lastName.trim();
  if (last.length > 100) e.lastName = 'Keep it under 100 characters';
  else if (last && !NAME.test(last)) e.lastName = 'Use letters only';
  if (f.mobile.trim() && !/^[6-9]\d{9}$/.test(cleanMobile(f.mobile)))
    e.mobile = 'Enter a 10-digit mobile number starting with 6-9';
  if (f.dateOfBirth) {
    if (!isValidDate(f.dateOfBirth)) e.dateOfBirth = 'Enter a valid date';
    else if (f.dateOfBirth > istToday()) e.dateOfBirth = 'Date of birth cannot be in the future';
  } else if (f.ageYears.trim()) {
    const age = Number(f.ageYears);
    if (!Number.isInteger(age) || age < 0 || age > 150)
      e.ageYears = 'Age must be a whole number from 0 to 150';
  }
  if (f.abhaNumber.trim() && !/^\d{14}$/.test(cleanAbha(f.abhaNumber)))
    e.abhaNumber = 'ABHA number has 14 digits';
  if (f.city.length > 100) e.city = 'Keep it under 100 characters';
  return e;
}

export function toCreatePatient(f: PatientForm): CreatePatient {
  return createPatientSchema.parse({
    firstName: f.firstName.trim(),
    lastName: f.lastName.trim() || undefined,
    gender: f.gender,
    dateOfBirth: f.dateOfBirth || undefined,
    ageYears: !f.dateOfBirth && f.ageYears.trim() ? Number(f.ageYears) : undefined,
    mobile: f.mobile.trim() ? cleanMobile(f.mobile) : undefined,
    abhaNumber: f.abhaNumber.trim() ? cleanAbha(f.abhaNumber) : undefined,
    address: f.city.trim() ? { city: f.city.trim() } : undefined,
  });
}

/** Prefills a form from what was typed in a patient search: digits become the mobile, words the name. */
export function formFromSearch(typed: string): PatientForm {
  const t = typed.trim();
  if (/^[+\d\s-]{6,}$/.test(t)) return { ...EMPTY_PATIENT_FORM, mobile: t };
  const [first = '', ...rest] = t.split(/\s+/);
  return { ...EMPTY_PATIENT_FORM, firstName: first, lastName: rest.join(' ') };
}

export function FieldError({ children }: { children?: string }) {
  if (!children) return null;
  return <p className="mt-1 text-xs text-destructive">{children}</p>;
}

/**
 * Registers a patient without leaving the current screen (used from Book appointment). Runs the same
 * duplicate check as front desk registration and offers the existing record instead.
 */
export function QuickRegister({
  initial,
  onCreated,
  onCancel,
}: {
  initial?: PatientForm;
  onCreated: (p: Patient) => void;
  onCancel: () => void;
}) {
  const canDedupe = usePermission('frontoffice.patient.dedupe');
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<PatientForm>(initial ?? EMPTY_PATIENT_FORM);
  const [submitted, setSubmitted] = React.useState(false);
  const [touched, setTouched] = React.useState<Partial<Record<keyof PatientForm, boolean>>>({});
  const [confirmed, setConfirmed] = React.useState(false);
  const errors = validatePatientForm(form);
  const shown = (k: keyof PatientForm) => (submitted || touched[k] ? errors[k] : undefined);
  const blur = (k: keyof PatientForm) => () => setTouched((t) => ({ ...t, [k]: true }));
  const set =
    (k: keyof PatientForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm((f) => ({ ...f, [k]: e.target.value }));
      setConfirmed(false);
    };

  const mobile = cleanMobile(form.mobile);
  const probe = useDebounced(
    {
      firstName: form.firstName.trim() || undefined,
      lastName: form.lastName.trim() || undefined,
      mobile: /^\d{10}$/.test(mobile) ? mobile : undefined,
      dateOfBirth: isValidDate(form.dateOfBirth) ? form.dateOfBirth : undefined,
    },
    400,
  );
  const hasProbe = (probe.firstName?.length ?? 0) >= 2 || !!probe.mobile;
  const dupes = useQuery({
    queryKey: ['frontoffice', 'duplicates', probe],
    queryFn: () => api.frontoffice.patients.duplicates(probe),
    enabled: canDedupe && hasProbe,
  });
  const strong = (dupes.data ?? []).filter((d) => d.score >= 60);

  const create = useMutation({
    mutationFn: () => api.patients.create(toCreatePatient(form)),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      onCreated(p);
    },
  });
  const save = () => {
    setSubmitted(true);
    if (Object.keys(errors).length || (strong.length > 0 && !confirmed)) return;
    create.mutate();
  };
  const pickExisting = async (id: string) => onCreated(await api.patients.get(id));

  return (
    <div className="rounded-md border bg-muted/20 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium">New patient</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Back to patient search"
          onClick={onCancel}
        >
          <X />
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="qr-first">First name *</Label>
          <Input
            id="qr-first"
            className="mt-1"
            value={form.firstName}
            onChange={set('firstName')}
            onBlur={blur('firstName')}
            aria-invalid={!!shown('firstName')}
            autoFocus
          />
          <FieldError>{shown('firstName')}</FieldError>
        </div>
        <div>
          <Label htmlFor="qr-last">Last name</Label>
          <Input
            id="qr-last"
            className="mt-1"
            value={form.lastName}
            onChange={set('lastName')}
            onBlur={blur('lastName')}
            aria-invalid={!!shown('lastName')}
          />
          <FieldError>{shown('lastName')}</FieldError>
        </div>
        <div>
          <Label htmlFor="qr-gender">Gender *</Label>
          <Select id="qr-gender" className="mt-1" value={form.gender} onChange={set('gender')}>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {genderLabel(g)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="qr-mobile">Mobile</Label>
          <Input
            id="qr-mobile"
            type="tel"
            inputMode="numeric"
            className="mt-1"
            placeholder="10 digits"
            value={form.mobile}
            onChange={set('mobile')}
            onBlur={blur('mobile')}
            aria-invalid={!!shown('mobile')}
          />
          <FieldError>{shown('mobile')}</FieldError>
        </div>
        <div>
          <Label htmlFor="qr-dob">Date of birth</Label>
          <Input
            id="qr-dob"
            type="date"
            className="mt-1"
            max={istToday()}
            value={form.dateOfBirth}
            onChange={set('dateOfBirth')}
            onBlur={blur('dateOfBirth')}
            aria-invalid={!!shown('dateOfBirth')}
          />
          {shown('dateOfBirth') ? (
            <FieldError>{shown('dateOfBirth')}</FieldError>
          ) : (
            form.dateOfBirth && (
              <p className="mt-1 text-xs text-muted-foreground">{longDate(form.dateOfBirth)}</p>
            )
          )}
        </div>
        <div>
          <Label htmlFor="qr-age">Age (if DOB unknown)</Label>
          <Input
            id="qr-age"
            type="number"
            min={0}
            max={150}
            step={1}
            className="mt-1"
            value={form.ageYears}
            onChange={set('ageYears')}
            onBlur={blur('ageYears')}
            disabled={!!form.dateOfBirth}
            aria-invalid={!!shown('ageYears')}
          />
          <FieldError>{shown('ageYears')}</FieldError>
        </div>
      </div>

      {strong.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="flex items-center gap-1 text-sm font-medium">
            <AlertTriangle className="size-4 text-destructive" /> This may be an existing patient
          </p>
          {strong.slice(0, 3).map((d) => (
            <div
              key={d.patient.id}
              className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm"
            >
              <div>
                <span className="font-medium">{d.patient.name}</span>{' '}
                <span className="font-mono text-xs text-muted-foreground">{d.patient.uhid}</span>
                <div className="text-xs text-muted-foreground">
                  {genderLabel(d.patient.gender)} ·{' '}
                  {d.patient.dateOfBirth ? longDate(d.patient.dateOfBirth) : 'DOB —'} ·{' '}
                  {d.patient.mobile ?? 'no mobile'} · {d.reasons.join(', ')}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={d.score >= 80 ? 'destructive' : 'accent'}>{d.score}%</Badge>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => pickExisting(d.patient.id)}
                >
                  Use this patient
                </Button>
              </div>
            </div>
          ))}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I checked these and this is a different person.
          </label>
        </div>
      )}

      <div className="mt-3">
        <ErrorBox error={create.error} />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={create.isPending || (strong.length > 0 && !confirmed)}
          onClick={save}
        >
          {create.isPending && <Loader2 className="animate-spin" />}
          Register and select
        </Button>
      </div>
    </div>
  );
}
