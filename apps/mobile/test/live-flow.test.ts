// End-to-end OPD flow through the mobile data layer, against a server with the front office, EMR, reports and
// portal modules and a running worker. Opt-in: MOBILE_LIVE_API=http://localhost:4000/api/v1 pnpm test
// Each step skips cleanly when the module it needs is not on the server yet.
import { ApiError, createApiClient, createHttp } from '@hms/api-client';
import { describe, expect, it } from 'vitest';
import { AllergyConflictError, createMobileData, isMissingRoute } from '@/data/client';
import { isoDate } from '@/data/dates';

const BASE = process.env.MOBILE_LIVE_API;

async function signIn(identifier: string) {
  let token: string | null = null;
  const api = createApiClient({ baseUrl: BASE!, getAccessToken: () => token });
  const res = await api.auth.login({ tenantCode: 'demo', identifier, password: 'Demo@12345', client: 'mobile' });
  token = res.accessToken;
  return { api, user: res.user, data: createMobileData(api.http, { demoFallback: false }) };
}

async function until<T>(fn: () => Promise<T | undefined | null>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting for the worker');
    await new Promise((r) => setTimeout(r, 300));
  }
}

const routeExists = (p: Promise<unknown>) =>
  p.then(
    () => true,
    (err: unknown) => !isMissingRoute(err),
  );

describe.runIf(BASE)('live OPD flow (doctor, owner and patient apps)', () => {
  it('walk-in → doctor queue → call/start → Rx (edit, allergy override, sign) → timeline → owner summary → patient app', async (ctx) => {
    const reception = await signIn('reception@demo.hms');
    const doctor = await signIn('doctor@demo.hms');
    const owner = await signIn('owner@demo.hms');

    // A fresh patient so allergies and the timeline start empty.
    const suffix = String(Date.now()).slice(-8);
    const mobile = `9${suffix}1`.slice(0, 10);
    const patient = await reception.api.patients.create({ firstName: 'Mobile', lastName: `Test${suffix}`, gender: 'female', ageYears: 34, mobile });

    let visitId: string;
    try {
      visitId = (await reception.api.http.post<{ id: string }>('/frontoffice/walk-ins', { patientId: patient.id, doctorId: doctor.user.id })).id;
    } catch (err) {
      if (isMissingRoute(err)) return ctx.skip();
      throw err;
    }

    // Doctor app queue: the worker turns the check-in into an EMR queue row carrying the visit.
    const row = await until(async () => (await doctor.data.doctorQueue(isoDate(), doctor.user.id)).data.find((q) => q.patientId === patient.id && q.visitId === visitId));
    expect(row).toMatchObject({ uhid: patient.uhid, status: 'waiting', tokenNo: expect.any(Number) });
    expect(row.encounterId).toBeTruthy();
    const encounterId = row.encounterId!;

    // Staff app sees the same token; the doctor calls and starts it.
    await doctor.data.visitAction(visitId, 'call');
    expect((await reception.data.frontofficeQueue(doctor.user.id, isoDate())).data.find((q) => q.visitId === visitId)?.status).toBe('called');
    await doctor.data.visitAction(visitId, 'start');
    await doctor.data.startEncounter(encounterId);
    const started = (await doctor.data.doctorQueue(isoDate(), doctor.user.id)).data.find((q) => q.visitId === visitId);
    expect(started?.status).toBe('in_consultation');

    // Rx: first save, then the screen reloads the consultation and edits it.
    expect((await doctor.data.encounterRx(encounterId))?.lines).toEqual([]);
    const first = await doctor.data.createPrescription({
      patientId: patient.id,
      encounterId,
      lines: [{ drugName: 'Tab Dolo 650', dose: '1 tab', frequency: '1-0-1', days: 3, qty: 6 }],
      advice: 'Plenty of fluids',
      followUpDate: '2026-10-14',
    });
    expect(first).toMatchObject({ encounterId, rxNo: expect.any(String) });
    const reloaded = await doctor.data.encounterRx(encounterId);
    expect(reloaded).toMatchObject({ signed: false, advice: 'Plenty of fluids', followUpDate: '2026-10-14' });
    expect(reloaded?.lines.map((l) => l.drugName)).toEqual(['Tab Dolo 650']);

    // Allergy recorded after the first Rx: the server rejects Augmentin until the doctor gives a reason.
    await reception.api.patients.update(patient.id, { allergies: ['Penicillin'] });
    const lines = [...(reloaded?.lines ?? []), { drugName: 'Tab Augmentin 625', dose: '1 tab', frequency: 'BD', days: 5, qty: 10 }];
    const conflict = await doctor.data.createPrescription({ patientId: patient.id, encounterId, lines }).catch((e: unknown) => e);
    expect(conflict).toBeInstanceOf(AllergyConflictError);
    expect((conflict as AllergyConflictError).conflicts[0]).toMatchObject({ drugName: 'Tab Augmentin 625', allergy: 'Penicillin' });
    const signed = await doctor.data.createPrescription({
      patientId: patient.id,
      encounterId,
      sign: true,
      lines: lines.map((l) => (l.drugName.includes('Augmentin') ? { ...l, allergyOverrideReason: 'Tolerated before, no reaction' } : l)),
    });
    expect(signed.prescriptionId).toBeTruthy();
    expect((await doctor.data.encounterRx(encounterId))?.signed).toBe(true);
    await doctor.data.visitAction(visitId, 'complete');

    // Timeline on the patient chart.
    const timeline = await doctor.data.timeline(patient.id);
    expect(timeline.demo).toBe(false);
    const visit = timeline.data.find((e) => e.id === encounterId);
    expect(visit?.type).toBe('encounter');
    expect(visit?.details).toEqual(expect.arrayContaining(['Rx: Tab Dolo 650 1 tab 1-0-1 × 3 days', 'Follow-up: 2026-10-14']));

    // Favourites round-trip on the server.
    const fav = await doctor.data.saveFavourite(`Fever ${suffix}`, [{ drugName: 'Tab Dolo 650', dose: '1 tab', frequency: 'TDS', days: 3, qty: 9 }]);
    expect((await doctor.data.favourites())?.map((f) => f.id)).toContain(fav.id);
    await doctor.data.deleteFavourite(fav.id);
    expect((await doctor.data.favourites())?.map((f) => f.id)).not.toContain(fav.id);

    // Owner app: real numbers (event-fed, so wait for the worker).
    if (await routeExists(owner.data.ownerSummary(isoDate()))) {
      const summary = await until(async () => {
        const s = await owner.data.ownerSummary(isoDate());
        return s.data.opdVisits >= 1 && s.data.consultationsSigned >= 1 ? s : null;
      });
      expect(summary.demo).toBe(false);
    }
    // A doctor is not allowed the owner summary.
    const forbidden = await doctor.data.ownerSummary(isoDate()).catch((e: unknown) => e);
    if (!isMissingRoute(forbidden)) expect((forbidden as ApiError).status).toBe(403);

    // Patient app: OTP sign-in with the dev code, then the prescription shows up in Records.
    const anon = createHttp({ baseUrl: BASE!, getAccessToken: () => null });
    let otp: { devCode?: string };
    try {
      otp = await anon.request<{ devCode?: string }>('POST', '/portal/auth/otp/request', { body: { tenantCode: 'demo', mobile }, auth: false });
    } catch (err) {
      if (isMissingRoute(err)) return;
      throw err;
    }
    expect(otp.devCode).toMatch(/^\d{6}$/);
    const login = await anon.request<{ accessToken: string; refreshToken?: string; me: { patients: { id: string }[] } }>(
      'POST',
      '/portal/auth/otp/verify',
      { body: { tenantCode: 'demo', mobile, otp: otp.devCode, client: 'mobile', deviceName: 'vitest' }, auth: false },
    );
    expect(login.refreshToken).toBeTruthy();
    expect(login.me.patients.map((p) => p.id)).toContain(patient.id);
    const patientData = createMobileData(createHttp({ baseUrl: BASE!, getAccessToken: () => login.accessToken }), { demoFallback: false });
    const rx = await until(async () => (await patientData.portalList('prescriptions')).data.find((r) => r.lines.some((l) => l.startsWith('Tab Augmentin 625'))));
    expect(rx.lines).toEqual(expect.arrayContaining(['Tab Dolo 650 1 tab 1-0-1 × 3 days']));
    await expect(patientData.portalList('appointments')).resolves.toMatchObject({ demo: false });
    await expect(patientData.portalList('bills')).resolves.toMatchObject({ demo: false });

    // The staff token cannot read the patient portal, and the patient token cannot read staff routes.
    await expect(doctor.api.http.get('/portal/prescriptions')).rejects.toMatchObject({ status: 401 });
    await expect(patientData.patient(patient.id)).rejects.toMatchObject({ status: 401 });
  }, 60_000);
});
