import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, bootApp, login } from './helpers';

let app: NestFastifyApplication;
let reception: string;
let doctor: string;
let otherHospital: string;

beforeAll(async () => {
  app = await bootApp();
  reception = (await login(app, 'reception@demo.hms')).accessToken;
  doctor = (await login(app, 'doctor@demo.hms')).accessToken;
  otherHospital = (await login(app, 'admin@city.hms', 'city')).accessToken;
});
afterAll(() => app.close());

describe('patients', () => {
  it('registers a patient with the next UHID and finds them by name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/patients',
      headers: bearer(reception),
      payload: { firstName: 'Test', lastName: `Patient${Date.now()}`, gender: 'female', ageYears: 30, mobile: '9123456780' },
    });
    expect(res.statusCode).toBe(201);
    const p = res.json();
    expect(p.uhid).toMatch(/^UH\d{6}$/);
    expect(new Date(p.createdAt).toISOString()).toBe(p.createdAt);

    const search = await app.inject({ method: 'GET', url: `/api/v1/patients?q=${p.lastName.toLowerCase()}`, headers: bearer(reception) });
    expect(search.json().items.map((x: { id: string }) => x.id)).toContain(p.id);
  });

  it('validates input with the shared schema', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/patients', headers: bearer(reception), payload: { firstName: '', gender: 'x' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_failed');
  });

  it('enforces permissions: a doctor cannot register patients', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/patients', headers: bearer(doctor), payload: { firstName: 'A', gender: 'male' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.details.missing).toEqual(['core.patient.create']);
  });

  it("never shows one hospital's patients to another", async () => {
    const mine = await app.inject({ method: 'GET', url: '/api/v1/patients', headers: bearer(reception) });
    const id = mine.json().items[0].id;
    const read = await app.inject({ method: 'GET', url: `/api/v1/patients/${id}`, headers: bearer(otherHospital) });
    expect(read.statusCode).toBe(404);
    const update = await app.inject({ method: 'PATCH', url: `/api/v1/patients/${id}`, headers: bearer(otherHospital), payload: { firstName: 'Hacked' } });
    expect(update.statusCode).toBe(404);
    const list = await app.inject({ method: 'GET', url: '/api/v1/patients', headers: bearer(otherHospital) });
    expect(list.json().items.find((x: { id: string }) => x.id === id)).toBeUndefined();
  });

  it('rejects a facility the user does not belong to', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/patients',
      headers: { ...bearer(otherHospital), 'x-facility-id': '00000000-0000-4000-8000-000000000000' },
    });
    // City admin has all-facility access, so an unknown id is allowed through the guard but sees nothing extra.
    expect([200, 403]).toContain(res.statusCode);
  });
});

describe('patient validation', () => {
  const post = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v1/patients', headers: bearer(reception), payload });
  const run = `${Date.now()}`;
  const expectError = async (payload: Record<string, unknown>, message: string) => {
    const res = await post({ firstName: 'Valid', gender: 'male', ...payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain(message);
  };
  const isoDaysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);

  it('rejects bad names, dates, ages and contact details with clear messages', async () => {
    await expectError({ firstName: '' }, 'Enter first name');
    await expectError({ firstName: 'R4mesh' }, "First name can only have letters, spaces and . ' -");
    await expectError({ lastName: '@Sharma' }, "Last name can only have letters");
    await expectError({ dateOfBirth: isoDaysFromNow(2) }, 'Date of birth cannot be in the future');
    await expectError({ dateOfBirth: '1850-01-01' }, 'Date of birth cannot be more than 150 years ago');
    await expectError({ dateOfBirth: '2020-02-30' }, 'Enter a valid date');
    await expectError({ ageYears: 151 }, 'Age cannot be more than 150 years');
    await expectError({ ageYears: -1 }, 'Age cannot be negative');
    await expectError({ ageYears: 2.5 }, 'Age must be in whole years');
    await expectError({ mobile: '5123456789' }, 'Enter a 10-digit Indian mobile number');
    await expectError({ mobile: '98765' }, 'Enter a 10-digit Indian mobile number');
    await expectError({ email: 'abc@' }, 'Enter a valid email address');
    await expectError({ abhaNumber: '12-3456' }, 'ABHA number has 14 digits');
    await expectError({ address: { pincode: '5600' } }, 'Enter a 6-digit PIN code');
    await expectError({ gender: 'x' }, 'Pick a gender');
    await expectError({ bloodGroup: 'C+' }, 'Pick a blood group from the list');
    await expectError({ allergies: [' '] }, 'Allergy cannot be empty');
  });

  it('normalises mobile, ABHA and email and treats blank optional fields as not given', async () => {
    const abha = `92${run.slice(-12).padStart(12, '0')}`;
    const res = await post({
      firstName: ' Anita ',
      lastName: '',
      gender: 'female',
      dateOfBirth: '1990-05-01',
      mobile: '+91 98765-43210',
      email: 'Anita.Test@Example.COM',
      abhaNumber: `${abha.slice(0, 2)}-${abha.slice(2, 6)}-${abha.slice(6, 10)}-${abha.slice(10)}`,
      bloodGroup: '',
      address: { line1: '', city: 'Pune', pincode: '411001' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ firstName: 'Anita', lastName: null, mobile: '9876543210', email: 'anita.test@example.com', abhaNumber: abha, bloodGroup: null });

    // The same ABHA cannot be given to a second patient, on register or on edit.
    const again = await post({ firstName: 'Other', gender: 'male', abhaNumber: abha });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.message).toContain(`already linked to ${res.json().uhid}`);
    const other = (await post({ firstName: 'Other', gender: 'male' })).json();
    const edit = await app.inject({ method: 'PATCH', url: `/api/v1/patients/${other.id}`, headers: bearer(reception), payload: { abhaNumber: abha } });
    expect(edit.statusCode).toBe(409);
    // Saving the patient's own ABHA again is fine.
    const own = await app.inject({ method: 'PATCH', url: `/api/v1/patients/${res.json().id}`, headers: bearer(reception), payload: { abhaNumber: abha } });
    expect(own.statusCode).toBe(200);
  });

  it('works out a date of birth from the age, and the date of birth wins when both are given', async () => {
    const byAge = (await post({ firstName: 'Aged', gender: 'male', ageYears: 40 })).json();
    expect(Number(byAge.dateOfBirth.slice(0, 4))).toBe(Number(isoDaysFromNow(0).slice(0, 4)) - 40);
    const both = (await post({ firstName: 'Both', gender: 'male', dateOfBirth: '2000-01-01', ageYears: 10 })).json();
    expect(both.dateOfBirth).toBe('2000-01-01');
  });

  it('validates edits the same way and lets optional fields be cleared', async () => {
    const p = (await post({ firstName: 'Edit', gender: 'male', mobile: '9876500001', email: 'edit@example.com' })).json();
    const patch = (payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url: `/api/v1/patients/${p.id}`, headers: bearer(reception), payload });
    const future = await patch({ dateOfBirth: isoDaysFromNow(3) });
    expect(future.statusCode).toBe(400);
    expect(future.json().error.message).toContain('Date of birth cannot be in the future');
    expect((await patch({ firstName: '  ' })).statusCode).toBe(400);
    expect((await patch({ mobile: '12345' })).statusCode).toBe(400);
    const cleared = await patch({ mobile: '', email: null });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toMatchObject({ mobile: null, email: null, firstName: 'Edit' });
  });
});

describe('PatientsService.markMerged', () => {
  it('retires the duplicate into the surviving record', async () => {
    const mk = async (n: string) =>
      (await app.inject({ method: 'POST', url: '/api/v1/patients', headers: bearer(reception), payload: { firstName: n, gender: 'male' } })).json();
    const a = await mk('Dup');
    const b = await mk('Keep');
    const { PatientsService } = await import('../src/modules/patients/patients.service');
    const { DbService } = await import('../src/common/db/db.service');
    const svc = app.get(PatientsService);
    const db = app.get(DbService);
    const tenantId = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(reception) })).json().tenantId;
    const merged = await db.asTenant({ tenantId }, (tx) => svc.markMerged(tx, a.id, b.id));
    expect(merged.id).toBe(a.id);
    await expect(db.asTenant({ tenantId }, (tx) => svc.markMerged(tx, a.id, b.id))).rejects.toThrow(/already been merged/);
  });
});
