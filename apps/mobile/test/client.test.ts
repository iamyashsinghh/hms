import { createHttp } from '@hms/api-client';
import { describe, expect, it, vi } from 'vitest';
import { AllergyConflictError, FeatureUnavailableError, createMobileData, isMissingRoute } from '@/data/client';
import { ApiError } from '@hms/api-client';

type Handler = (url: URL, init: RequestInit) => { status: number; body?: unknown };

function fakeHttp(handler: Handler) {
  const calls: { method: string; url: URL; body: unknown; auth: string | null }[] = [];
  const fetchImpl = vi.fn(async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const headers = init.headers as Record<string, string>;
    calls.push({ method: init.method ?? 'GET', url, body: init.body ? JSON.parse(String(init.body)) : undefined, auth: headers.authorization ?? null });
    const { status, body } = handler(url, init);
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  });
  const http = createHttp({ baseUrl: 'http://api.test/api/v1', getAccessToken: () => 'tok', fetch: fetchImpl as unknown as typeof fetch });
  return { http, calls };
}

const missingRoute = (url: URL) => ({ status: 404, body: { error: { code: 'not_found', message: `Cannot GET ${url.pathname}` } } });

describe('isMissingRoute', () => {
  it('tells a missing route from a missing record', () => {
    expect(isMissingRoute(new ApiError(404, 'not_found', 'Cannot GET /api/v1/emr/queue'))).toBe(true);
    expect(isMissingRoute(new ApiError(404, 'not_found', 'Patient not found'))).toBe(false);
    expect(isMissingRoute(new Error('Cannot GET /x'))).toBe(false);
  });
});

describe('createMobileData', () => {
  it('calls the agreed EMR queue endpoint with the date and normalizes it', async () => {
    const { http, calls } = fakeHttp(() => ({ status: 200, body: [{ visitId: 'v1', patientId: 'p1', patientName: 'A', tokenNo: 1, status: 'waiting' }] }));
    const res = await createMobileData(http, { demoFallback: false }).doctorQueue('2026-10-07', 'doc1');
    expect(calls[0]?.url.pathname).toBe('/api/v1/emr/queue');
    expect(calls[0]?.url.searchParams.get('date')).toBe('2026-10-07');
    expect(calls[0]?.auth).toBe('Bearer tok');
    expect(res).toMatchObject({ demo: false, data: [{ id: 'v1', patientName: 'A' }] });
  });

  it('falls back to demo data built from real patients when the route is missing and demo is allowed', async () => {
    const { http } = fakeHttp((url) =>
      url.pathname === '/api/v1/patients'
        ? { status: 200, body: { items: [{ id: 'real-1', uhid: 'U1', firstName: 'Asha', lastName: null, gender: 'female', ageYears: 33 }], page: 1, pageSize: 6, total: 1 } }
        : missingRoute(url),
    );
    const res = await createMobileData(http, { demoFallback: true }).doctorQueue('2026-10-07', 'doc1');
    expect(res.demo).toBe(true);
    expect(res.data[0]).toMatchObject({ patientId: 'real-1', patientName: 'Asha', uhid: 'U1' });
  });

  it('throws FeatureUnavailableError in release builds when the route is missing', async () => {
    const { http } = fakeHttp(missingRoute);
    const d = createMobileData(http, { demoFallback: false });
    await expect(d.doctorQueue('2026-10-07', 'doc1')).rejects.toBeInstanceOf(FeatureUnavailableError);
    await expect(d.ownerSummary('2026-10-07')).rejects.toBeInstanceOf(FeatureUnavailableError);
    await expect(d.timeline('p1')).rejects.toBeInstanceOf(FeatureUnavailableError);
  });

  it("uses the front-office queue filtered to the doctor until EMR's queue exists", async () => {
    const { http, calls } = fakeHttp((url) =>
      url.pathname === '/api/v1/frontoffice/queue'
        ? {
            status: 200,
            body: {
              date: '2026-10-07',
              items: [
                {
                  id: 'visit-1',
                  visitNo: 'V-1',
                  patientId: 'p1',
                  patient: { id: 'p1', uhid: 'UH1', name: 'Asha Rao', gender: 'female', dateOfBirth: null, mobile: null },
                  doctorName: 'Dr. X',
                  tokenNo: 3,
                  status: 'called',
                  room: 'Cabin 2',
                  checkedInAt: '2026-10-07T04:00:00Z',
                },
              ],
              summary: {},
            },
          }
        : missingRoute(url),
    );
    const res = await createMobileData(http, { demoFallback: true }).doctorQueue('2026-10-07', 'doc1');
    expect(calls.map((c) => c.url.pathname + c.url.search)).toEqual([
      '/api/v1/emr/queue?date=2026-10-07',
      '/api/v1/frontoffice/queue?doctorId=doc1&date=2026-10-07',
    ]);
    expect(res.demo).toBe(false);
    expect(res.data[0]).toMatchObject({ id: 'visit-1', visitId: 'visit-1', patientName: 'Asha Rao', uhid: 'UH1', status: 'called', room: 'Cabin 2' });
  });

  it('posts queue transitions to the front-office visit', async () => {
    const { http, calls } = fakeHttp(() => ({ status: 200, body: {} }));
    await createMobileData(http, { demoFallback: false }).visitAction('visit-1', 'call', 'Cabin 2');
    expect(calls[0]).toMatchObject({ method: 'POST', body: { action: 'call', room: 'Cabin 2' } });
    expect(calls[0]?.url.pathname).toBe('/api/v1/frontoffice/visits/visit-1/transition');
  });

  it('passes other errors through (no demo data on a 403 or a missing record)', async () => {
    const { http } = fakeHttp(() => ({ status: 403, body: { error: { code: 'forbidden', message: 'Not allowed' } } }));
    await expect(createMobileData(http, { demoFallback: true }).ownerSummary('2026-10-07')).rejects.toMatchObject({ status: 403 });
  });

  it('never fakes a prescription write', async () => {
    const { http } = fakeHttp((url) => ({ status: 404, body: { error: { code: 'not_found', message: `Cannot POST ${url.pathname}` } } }));
    const d = createMobileData(http, { demoFallback: true });
    await expect(d.createPrescription({ patientId: 'p1', lines: [] })).rejects.toBeInstanceOf(FeatureUnavailableError);
  });

  it('posts the prescription body and returns the id', async () => {
    const { http, calls } = fakeHttp(() => ({ status: 201, body: { prescriptionId: 'rx1', encounterId: 'e1', rxNo: 'RX000001' } }));
    const body = { patientId: 'p1', lines: [{ drugName: 'X', dose: '1', frequency: '1-0-1', days: 5, qty: 10 }] };
    await expect(createMobileData(http, { demoFallback: false }).createPrescription(body)).resolves.toEqual({
      prescriptionId: 'rx1',
      encounterId: 'e1',
      rxNo: 'RX000001',
    });
    expect(calls[0]).toMatchObject({ method: 'POST', body });
    expect(calls[0]?.url.pathname).toBe('/api/v1/emr/prescriptions');
  });

  it('turns a 409 allergy_conflict into AllergyConflictError with the conflicting lines', async () => {
    const conflicts = [{ line: 0, drugName: 'Tab Augmentin', allergy: 'Penicillin' }];
    const { http } = fakeHttp(() => ({ status: 409, body: { error: { code: 'allergy_conflict', message: 'Patient is allergic to Penicillin', details: { conflicts } } } }));
    const err = await createMobileData(http, { demoFallback: false })
      .createPrescription({ patientId: 'p1', lines: [{ drugName: 'Tab Augmentin', dose: '1', frequency: 'BD', days: 5, qty: 10 }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AllergyConflictError);
    expect((err as AllergyConflictError).conflicts).toEqual(conflicts);
  });

  it('loads an open consultation so the Rx screen edits its prescription', async () => {
    const { http } = fakeHttp(() => ({
      status: 200,
      body: {
        id: 'e1',
        status: 'in_progress',
        signedAt: null,
        notes: { advice: 'Rest' },
        followUpDate: '2026-10-14',
        prescription: { id: 'rx1', lines: [{ id: 'l1', drugName: 'Tab X', dose: '1 tab', frequency: 'BD', days: 3, qty: 6, instructions: null, itemCode: null, allergyOverrideReason: null }] },
      },
    }));
    await expect(createMobileData(http, { demoFallback: false }).encounterRx('e1')).resolves.toEqual({
      encounterId: 'e1',
      status: 'in_progress',
      signed: false,
      advice: 'Rest',
      followUpDate: '2026-10-14',
      lines: [{ drugName: 'Tab X', dose: '1 tab', frequency: 'BD', days: 3, qty: 6 }],
    });
  });

  it('favourites come from the server, or null when the EMR is not there', async () => {
    const ok = fakeHttp(() => ({ status: 200, body: [{ id: 'f1', name: 'Fever', lines: [{ drugName: 'Tab Dolo 650', dose: '1 tab', frequency: 'TDS', days: 3 }] }] }));
    await expect(createMobileData(ok.http, { demoFallback: false }).favourites()).resolves.toEqual([
      { id: 'f1', name: 'Fever', lines: [{ drugName: 'Tab Dolo 650', dose: '1 tab', frequency: 'TDS', days: 3, qty: 0 }] },
    ]);
    const missing = fakeHttp(missingRoute);
    await expect(createMobileData(missing.http, { demoFallback: false }).favourites()).resolves.toBeNull();
  });

  it('owner summary, front-office queue and portal lists hit their endpoints', async () => {
    const { http, calls } = fakeHttp(() => ({ status: 200, body: [] }));
    const d = createMobileData(http, { demoFallback: false });
    await d.ownerSummary('2026-10-07');
    await d.frontofficeQueue('doc1', '2026-10-07');
    await d.portalList('bills');
    expect(calls.map((c) => c.url.pathname + c.url.search)).toEqual([
      '/api/v1/reports/owner-summary?date=2026-10-07',
      '/api/v1/frontoffice/queue?doctorId=doc1&date=2026-10-07',
      '/api/v1/portal/bills',
    ]);
  });
});
