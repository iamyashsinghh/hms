'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { hr as H, setup as S, todayIso } from '@hms/shared';
import { api } from '@/lib/api';
import { validate, type FieldErrors } from '@/lib/validate';
import { useAuth, usePermission } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { CATEGORY_LABELS, EMPLOYMENT_LABELS, ErrorBox, Field, todayIST } from './ui';

export interface EmployeeFormValues {
  userId: string;
  employeeCode: string;
  fullName: string;
  gender: string;
  dateOfBirth: string;
  mobile: string;
  email: string;
  category: H.EmployeeCategory;
  designation: string;
  department: string;
  facilityId: string;
  employmentType: H.EmploymentType;
  dateOfJoining: string;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  pan: string;
  uan: string;
  esicNo: string;
  bankAccountNo: string;
  bankIfsc: string;
  bankName: string;
  basic: string;
  hra: string;
  otherAllowances: string;
  pfApplicable: boolean;
  esiApplicable: boolean;
  professionalTax: string;
  tdsMonthly: string;
}

export function emptyEmployee(): EmployeeFormValues {
  return {
    userId: '', employeeCode: '', fullName: '', gender: '', dateOfBirth: '', mobile: '', email: '', category: 'nurse', designation: '',
    department: '', facilityId: '', employmentType: 'permanent', dateOfJoining: todayIST(), address: '', emergencyContactName: '',
    emergencyContactPhone: '', pan: '', uan: '', esicNo: '', bankAccountNo: '', bankIfsc: '', bankName: '', basic: '', hra: '',
    otherAllowances: '', pfApplicable: false, esiApplicable: false, professionalTax: '200', tdsMonthly: '',
  };
}

export function fromEmployee(e: H.Employee): EmployeeFormValues {
  const s = e.salary;
  const b = e.bank;
  return {
    userId: e.userId ?? '', employeeCode: e.employeeCode, fullName: e.fullName, gender: e.gender ?? '', dateOfBirth: e.dateOfBirth ?? '',
    mobile: e.mobile ?? '', email: e.email ?? '', category: e.category, designation: e.designation ?? '', department: e.department ?? '',
    facilityId: e.facilityId ?? '', employmentType: e.employmentType, dateOfJoining: e.dateOfJoining, address: e.address ?? '',
    emergencyContactName: e.emergencyContactName ?? '', emergencyContactPhone: e.emergencyContactPhone ?? '',
    pan: b?.pan ?? '', uan: b?.uan ?? '', esicNo: b?.esicNo ?? '', bankAccountNo: b?.bankAccountNo ?? '', bankIfsc: b?.bankIfsc ?? '',
    bankName: b?.bankName ?? '', basic: s ? String(s.basic) : '', hra: s ? String(s.hra) : '', otherAllowances: s ? String(s.otherAllowances) : '',
    pfApplicable: s?.pfApplicable ?? false, esiApplicable: s?.esiApplicable ?? false, professionalTax: s ? String(s.professionalTax) : '',
    tdsMonthly: s ? String(s.tdsMonthly) : '',
  };
}

/** Request body; pay fields are only sent by users allowed to set them. */
export function toBody(f: EmployeeFormValues, includePay: boolean): H.UpdateEmployee & { employeeCode?: string } {
  const opt = (v: string) => v.trim() || null;
  const body: H.UpdateEmployee & { employeeCode?: string } = {
    userId: f.userId || null,
    fullName: f.fullName,
    gender: (f.gender || null) as H.UpdateEmployee['gender'],
    dateOfBirth: f.dateOfBirth || null,
    mobile: f.mobile || null,
    email: f.email || null,
    category: f.category,
    designation: opt(f.designation),
    department: opt(f.department),
    facilityId: f.facilityId || null,
    employmentType: f.employmentType,
    dateOfJoining: f.dateOfJoining,
    address: opt(f.address),
    emergencyContactName: opt(f.emergencyContactName),
    emergencyContactPhone: opt(f.emergencyContactPhone),
  };
  if (includePay) {
    Object.assign(body, {
      pan: f.pan || null, uan: f.uan || null, esicNo: opt(f.esicNo), bankAccountNo: f.bankAccountNo || null, bankIfsc: f.bankIfsc || null,
      bankName: opt(f.bankName), basic: Number(f.basic || 0), hra: Number(f.hra || 0), otherAllowances: Number(f.otherAllowances || 0),
      pfApplicable: f.pfApplicable, esiApplicable: f.esiApplicable, professionalTax: Number(f.professionalTax || 0), tdsMonthly: Number(f.tdsMonthly || 0),
    });
  }
  return body;
}

/** Picks a staff login from Setup and copies its profile into the form. */
function StaffPicker({ onPick }: { onPick: (s: S.StaffMember) => void }) {
  const canRead = usePermission('setup.staff.read');
  const { data } = useQuery({ queryKey: ['setup', 'staff', 'hr-picker'], queryFn: () => api.setup.listStaff({}), enabled: canRead });
  const { data: existing } = useQuery({ queryKey: ['hr', 'employees', 'all-users'], queryFn: () => api.hr.employees.list({ status: 'all', pageSize: 500 }) });
  if (!canRead) return null;
  const linked = new Set(existing?.items.map((e) => e.userId).filter(Boolean));
  const options = (data ?? []).filter((s) => !linked.has(s.userId));
  return (
    <Field id="staff" label="Copy from a staff login (Setup → Staff)">
      <Select
        id="staff"
        defaultValue=""
        onChange={(e) => {
          const s = options.find((x) => x.userId === e.target.value);
          if (s) onPick(s);
        }}
      >
        <option value="">— Staff without a login, or pick one —</option>
        {options.map((s) => (
          <option key={s.userId} value={s.userId}>
            {s.name}
            {s.profile?.designation ? ` · ${s.profile.designation}` : ''}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function EmployeeForm({
  initial,
  isNew,
  saving,
  error,
  onSubmit,
  onCancel,
}: {
  initial: EmployeeFormValues;
  isNew: boolean;
  saving: boolean;
  error: string | null;
  onSubmit: (f: EmployeeFormValues, staff: S.StaffMember | null) => void;
  onCancel?: () => void;
}) {
  const { user } = useAuth();
  const canPay = usePermission('hr.payroll.manage');
  const [f, setF] = React.useState(initial);
  const [staff, setStaff] = React.useState<S.StaffMember | null>(null);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const set = <K extends keyof EmployeeFormValues>(k: K, v: EmployeeFormValues[K]) => setF((x) => ({ ...x, [k]: v }));
  const { data: departments } = useQuery({ queryKey: ['hr', 'departments'], queryFn: () => api.hr.departments() });
  const gross = Number(f.basic || 0) + Number(f.hra || 0) + Number(f.otherAllowances || 0);

  const pick = (s: S.StaffMember) => {
    setStaff(s);
    const p = s.profile;
    setF((x) => ({
      ...x,
      userId: s.userId,
      fullName: s.name,
      mobile: s.mobile ?? '',
      email: s.email ?? '',
      category: (p?.staffType as H.EmployeeCategory) ?? x.category,
      designation: p?.designation ?? x.designation,
      department: p?.departmentName ?? x.department,
      gender: p?.gender && ['male', 'female', 'other'].includes(p.gender) ? p.gender : x.gender,
      dateOfJoining: p?.dateOfJoining ?? x.dateOfJoining,
      employeeCode: p?.employeeCode ?? x.employeeCode,
    }));
  };

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        // Same rules as the API, so mistakes show next to the field before saving.
        const body = { ...toBody(f, canPay), employeeCode: isNew ? f.employeeCode || undefined : undefined };
        const r = validate(isNew ? H.createEmployeeSchema : H.updateEmployeeSchema, body);
        setErrors(r.errors ?? {});
        if (r.errors) return;
        onSubmit(f, staff);
      }}
    >
      <ErrorBox error={error ?? (Object.keys(errors).length ? 'Please correct the highlighted fields.' : null)} />
      <Card>
        <CardHeader>
          <CardTitle>Person</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          {isNew && (
            <div className="sm:col-span-3">
              <StaffPicker onPick={pick} />
            </div>
          )}
          <Field id="name" error={errors.fullName} label="Full name *" className="sm:col-span-2">
            <Input id="name" maxLength={150} value={f.fullName} onChange={(e) => set('fullName', e.target.value)} required />
          </Field>
          <Field id="code" error={errors.employeeCode} label={isNew ? 'Employee code (blank = automatic)' : 'Employee code'}>
            <Input id="code" value={f.employeeCode} disabled={!isNew} onChange={(e) => set('employeeCode', e.target.value.toUpperCase())} placeholder="EMP00001" />
          </Field>
          <Field id="gender" error={errors.gender} label="Gender">
            <Select id="gender" value={f.gender} onChange={(e) => set('gender', e.target.value)}>
              <option value="">—</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field id="dob" error={errors.dateOfBirth} label="Date of birth">
            <Input id="dob" type="date" min={todayIso(-150 * 365)} max={todayIso()} value={f.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
          </Field>
          <Field id="mobile" error={errors.mobile} label="Mobile">
            <Input id="mobile" inputMode="numeric" maxLength={10} placeholder="10 digits" value={f.mobile} onChange={(e) => set('mobile', e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field id="email" error={errors.email} label="Email">
            <Input id="email" type="email" maxLength={254} value={f.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field id="ecn" error={errors.emergencyContactName} label="Emergency contact">
            <Input id="ecn" value={f.emergencyContactName} onChange={(e) => set('emergencyContactName', e.target.value)} placeholder="Name" />
          </Field>
          <Field id="ecp" error={errors.emergencyContactPhone} label="Emergency phone">
            <Input id="ecp" type="tel" inputMode="tel" maxLength={20} value={f.emergencyContactPhone} onChange={(e) => set('emergencyContactPhone', e.target.value)} />
          </Field>
          <Field id="addr" error={errors.address} label="Address" className="sm:col-span-3">
            <Input id="addr" value={f.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
          {f.userId && <p className="text-xs text-muted-foreground sm:col-span-3">Linked to a staff login, so this person can punch in, apply for leave and see payslips under My HR.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Job</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field id="cat" label="Category">
            <Select id="cat" value={f.category} onChange={(e) => set('category', e.target.value as H.EmployeeCategory)}>
              {H.EMPLOYEE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="desig" error={errors.designation} label="Designation">
            <Input id="desig" value={f.designation} onChange={(e) => set('designation', e.target.value)} placeholder="e.g. Staff Nurse" />
          </Field>
          <Field id="dept" error={errors.department} label="Department / ward">
            <Input id="dept" list="hr-departments" value={f.department} onChange={(e) => set('department', e.target.value)} />
            <datalist id="hr-departments">
              {departments?.map((d) => <option key={d} value={d} />)}
            </datalist>
          </Field>
          <Field id="etype" label="Employment type">
            <Select id="etype" value={f.employmentType} onChange={(e) => set('employmentType', e.target.value as H.EmploymentType)}>
              {H.EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EMPLOYMENT_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="doj" error={errors.dateOfJoining} label="Date of joining *">
            <Input id="doj" type="date" min={f.dateOfBirth || '1950-01-01'} max={todayIso(366)} value={f.dateOfJoining} onChange={(e) => set('dateOfJoining', e.target.value)} required />
          </Field>
          <Field id="fac" label="Works at">
            <Select id="fac" value={f.facilityId} onChange={(e) => set('facilityId', e.target.value)}>
              <option value="">Any facility</option>
              {user?.facilities.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
        </CardContent>
      </Card>

      {canPay && (
        <Card>
          <CardHeader>
            <CardTitle>Salary, statutory and bank</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-4">
            <Field id="basic" error={errors.basic} label="Basic (₹/month)">
              <Input id="basic" type="number" min={0} step="0.01" value={f.basic} onChange={(e) => set('basic', e.target.value)} />
            </Field>
            <Field id="hra" error={errors.hra} label="HRA (₹/month)">
              <Input id="hra" type="number" min={0} step="0.01" value={f.hra} onChange={(e) => set('hra', e.target.value)} />
            </Field>
            <Field id="allow" error={errors.otherAllowances} label="Other allowances (₹/month)">
              <Input id="allow" type="number" min={0} step="0.01" value={f.otherAllowances} onChange={(e) => set('otherAllowances', e.target.value)} />
            </Field>
            <div className="pt-7 text-sm">
              Monthly gross <span className="font-semibold tabular-nums">₹{gross.toLocaleString('en-IN')}</span>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.pfApplicable} onChange={(e) => set('pfApplicable', e.target.checked)} /> PF (12% of basic, capped at ₹15,000)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.esiApplicable} onChange={(e) => set('esiApplicable', e.target.checked)} /> ESI (gross up to ₹21,000)
            </label>
            <Field id="pt" error={errors.professionalTax} label="Professional tax (₹/month)">
              <Input id="pt" type="number" min={0} step="0.01" value={f.professionalTax} onChange={(e) => set('professionalTax', e.target.value)} />
            </Field>
            <Field id="tds" error={errors.tdsMonthly} label="TDS (₹/month)">
              <Input id="tds" type="number" min={0} step="0.01" value={f.tdsMonthly} onChange={(e) => set('tdsMonthly', e.target.value)} />
            </Field>
            <Field id="pan" error={errors.pan} label="PAN">
              <Input id="pan" maxLength={10} value={f.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} />
            </Field>
            <Field id="uan" error={errors.uan} label="UAN (PF)">
              <Input id="uan" inputMode="numeric" maxLength={12} value={f.uan} onChange={(e) => set('uan', e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field id="esic" error={errors.esicNo} label="ESIC number">
              <Input id="esic" inputMode="numeric" maxLength={17} value={f.esicNo} onChange={(e) => set('esicNo', e.target.value.replace(/\D/g, ''))} />
            </Field>
            <div />
            <Field id="acct" error={errors.bankAccountNo} label="Bank account number">
              <Input id="acct" inputMode="numeric" maxLength={18} value={f.bankAccountNo} onChange={(e) => set('bankAccountNo', e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field id="ifsc" error={errors.bankIfsc} label="IFSC">
              <Input id="ifsc" maxLength={11} value={f.bankIfsc} onChange={(e) => set('bankIfsc', e.target.value.toUpperCase())} />
            </Field>
            <Field id="bank" error={errors.bankName} label="Bank name" className="sm:col-span-2">
              <Input id="bank" value={f.bankName} onChange={(e) => set('bankName', e.target.value)} />
            </Field>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          {isNew ? 'Add employee' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
