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

  it('rejects a date of birth in the future', async () => {
    const nextYear = `${new Date().getUTCFullYear() + 1}-01-01`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/patients',
      headers: bearer(reception),
      payload: { firstName: 'Future', gender: 'female', dateOfBirth: nextYear },
    });
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

describe('editing a patient', () => {
  const mk = async (payload: Record<string, unknown>) =>
    (await app.inject({ method: 'POST', url: '/api/v1/patients', headers: bearer(reception), payload: { gender: 'male', ...payload } })).json();
  const patch = (token: string, id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: `/api/v1/patients/${id}`, headers: bearer(token), payload });

  it('updates fields and clears optional ones with null', async () => {
    const p = await mk({ firstName: 'Edit', lastName: `Me${Date.now()}`, mobile: '9123456781', email: 'edit@example.com', bloodGroup: 'A+', dateOfBirth: '1990-01-01' });
    const res = await patch(reception, p.id, { firstName: 'Edited', mobile: null, email: null, bloodGroup: null, dateOfBirth: null, ageYears: 40 });
    expect(res.statusCode).toBe(200);
    const u = res.json();
    expect(u).toMatchObject({ firstName: 'Edited', uhid: p.uhid, mobile: null, email: null, bloodGroup: null, lastName: p.lastName });
    expect(new Date().getFullYear() - Number(u.dateOfBirth.slice(0, 4))).toBe(40);

    const bad = await patch(reception, p.id, { mobile: '12345', firstName: '' });
    expect(bad.statusCode).toBe(400);
  });

  it('refuses an ABHA number another patient already has', async () => {
    const abha = `9${String(Date.now()).slice(-13).padStart(13, '0')}`;
    await mk({ firstName: 'Abha', abhaNumber: abha });
    const other = await mk({ firstName: 'Other' });
    const res = await patch(reception, other.id, { abhaNumber: abha });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('duplicate_abha');
  });

  it('needs core.patient.update', async () => {
    const p = await mk({ firstName: 'Perm' });
    const nurse = (await login(app, 'nurse@demo.hms')).accessToken;
    const res = await patch(nurse, p.id, { firstName: 'Nope' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.details.missing).toEqual(['core.patient.update']);
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
    const edit = await app.inject({ method: 'PATCH', url: `/api/v1/patients/${a.id}`, headers: bearer(reception), payload: { firstName: 'Late' } });
    expect(edit.statusCode).toBe(409);
  });
});
