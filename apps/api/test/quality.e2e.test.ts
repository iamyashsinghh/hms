import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { config } from 'dotenv';
import { Client } from 'pg';
import { DEMO_PASSWORD, provisionTenant, sql } from '@hms/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbService } from '../src/common/db/db.service';
import { EventBus } from '../src/common/events/event-bus';
import { bearer, bootApp, login } from './helpers';

let app: NestFastifyApplication;
let admin: string;
let adminId: string;
let nurse: string;
let nurseId: string;
let reception: string;
let doctor: string;
let owner: string;
let otherHospital: string;
let starterHospital: string;

config({ path: resolve(__dirname, '../../../.env'), quiet: true });
/** City is on the Starter plan (no quality module), so isolation is proven against a throwaway Growth hospital. */
const OTHER = `quality-${Date.now().toString(36)}`;

async function provisionGrowthHospital() {
  const client = new Client({ connectionString: process.env.DATABASE_MIGRATOR_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await provisionTenant(client, {
      code: OTHER,
      name: `Quality Isolation ${OTHER}`,
      plan: 'growth',
      facility: { code: 'MAIN', name: 'Main' },
      admin: { name: 'Isolation Admin', email: `admin@${OTHER}.test`, password: DEMO_PASSWORD },
    });
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }
}
let tenantId: string;
let facilityId: string;
let patientId: string;
const tag = Date.now().toString(36).toUpperCase();

type Inject = Parameters<NestFastifyApplication['inject']>[0];
const call = (token: string, method: string, url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { ...bearer(token), 'x-facility-id': facilityId }, payload } as Inject);
const ok = async (token: string, method: string, url: string, payload?: unknown, status = method === 'POST' ? 201 : 200) => {
  const res = await call(token, method, url, payload);
  if (res.statusCode !== status) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
  return res.json();
};

const IST = 330 * 60_000;
const today = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const period = () => today().slice(0, 7);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const indicator = async (code: string) =>
  ((await ok(admin, 'GET', `/quality/indicators?period=${period()}`)) as { code: string; numerator: number | null; denominator: number | null; value: number | null }[]).find(
    (i) => i.code === code,
  )!;

const incident = (extra: Record<string, unknown> = {}) => ({
  kind: 'incident',
  category: 'medication_error',
  severity: 'mild',
  occurredAt: hoursAgo(2),
  location: `Ward 3 ${tag}`,
  description: 'Wrong dose of paracetamol charted; caught at second check.',
  ...extra,
});

beforeAll(async () => {
  app = await bootApp();
  const a = await login(app, 'admin@demo.hms');
  admin = a.accessToken;
  adminId = a.user.id;
  const me = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(admin) })).json();
  tenantId = me.tenantId;
  facilityId = me.facilities[0].id;
  const n = await login(app, 'nurse@demo.hms');
  nurse = n.accessToken;
  nurseId = n.user.id;
  reception = (await login(app, 'reception@demo.hms')).accessToken;
  doctor = (await login(app, 'doctor@demo.hms')).accessToken;
  owner = (await login(app, 'owner@demo.hms')).accessToken;
  starterHospital = (await login(app, 'admin@city.hms', 'city')).accessToken;
  await provisionGrowthHospital();
  otherHospital = (await login(app, `admin@${OTHER}.test`, OTHER)).accessToken;
  patientId = (await ok(admin, 'POST', '/patients', { firstName: 'Quality', lastName: `Case${tag}`, gender: 'female', ageYears: 52 })).id;
});
afterAll(() => app.close());

describe('quality: incidents', () => {
  it('lets any staff member report, shows reporters only their own, and runs the review → CAPA → close flow', async () => {
    const inc = await ok(nurse, 'POST', '/quality/incidents', incident({ patientId }));
    expect(inc.incidentNo).toMatch(/^IR\d{6}$/);
    expect(inc).toMatchObject({ status: 'reported', reportedBy: { id: nurseId }, patient: { id: patientId }, isAnonymous: false });

    // Reporter sees it under "mine" and can open it, but cannot list everyone's or review.
    const mine = await ok(nurse, 'GET', '/quality/incidents/mine?pageSize=200');
    expect(mine.items.map((i: { id: string }) => i.id)).toContain(inc.id);
    expect((await call(nurse, 'GET', `/quality/incidents/${inc.id}`)).statusCode).toBe(200);
    expect((await call(nurse, 'GET', '/quality/incidents')).statusCode).toBe(403);
    expect((await call(nurse, 'PATCH', `/quality/incidents/${inc.id}`, { status: 'under_review' })).statusCode).toBe(403);
    // Another reporter cannot open someone else's report.
    expect((await call(reception, 'GET', `/quality/incidents/${inc.id}`)).statusCode).toBe(404);

    // Invalid jumps are refused.
    const jump = await call(admin, 'PATCH', `/quality/incidents/${inc.id}`, { status: 'closed', note: 'x' });
    expect(jump.statusCode).toBe(409);
    expect(jump.json().error.code).toBe('invalid_transition');

    await ok(admin, 'PATCH', `/quality/incidents/${inc.id}`, { status: 'under_review', assignedTo: adminId });
    const noCapa = await call(admin, 'PATCH', `/quality/incidents/${inc.id}`, { status: 'action_planned' });
    expect(noCapa.json().error.code).toBe('capa_required');

    const capa = await ok(admin, 'POST', '/quality/capas', {
      sourceType: 'incident',
      sourceId: inc.id,
      title: 'Double-check high-alert drug doses',
      problem: 'Dose charted wrongly',
      ownerId: nurseId,
      dueDate: today(),
    });
    expect(capa.capaNo).toMatch(/^CAPA\d{5}$/);
    const planned = await ok(admin, 'PATCH', `/quality/incidents/${inc.id}`, {
      status: 'action_planned',
      rootCause: 'No independent double check',
      contributingFactors: ['Staffing', 'Look-alike labels'],
    });
    expect(planned.openCapas).toBe(1);

    // Cannot close while the CAPA is not verified.
    const early = await call(admin, 'PATCH', `/quality/incidents/${inc.id}`, { status: 'closed', note: 'Done' });
    expect(early.json().error.code).toBe('open_capa');

    // CAPA: completing needs the action and a note; verifying needs an effectiveness note.
    expect((await call(admin, 'PATCH', `/quality/capas/${capa.id}`, { status: 'completed', note: 'Done' })).json().error.code).toBe('action_required');
    await ok(admin, 'PATCH', `/quality/capas/${capa.id}`, { status: 'completed', correctiveAction: 'Two-nurse check added to MAR', note: 'Trained ward 3' });
    expect((await call(admin, 'PATCH', `/quality/capas/${capa.id}`, { status: 'verified' })).json().error.code).toBe('note_required');
    const verified = await ok(admin, 'PATCH', `/quality/capas/${capa.id}`, { status: 'verified', note: 'No repeat in 2 weeks of audits' });
    expect(verified).toMatchObject({ status: 'verified', verifiedBy: { id: adminId }, sourceLabel: `Incident ${inc.incidentNo}` });
    expect(verified.activity.map((a: { toStatus: string | null }) => a.toStatus)).toEqual(['open', 'completed', 'verified']);

    const closed = await ok(admin, 'PATCH', `/quality/incidents/${inc.id}`, { status: 'closed', note: 'Actions effective' });
    expect(closed).toMatchObject({ status: 'closed', closureNote: 'Actions effective', openCapas: 0 });
    expect(closed.activity.map((a: { toStatus: string | null }) => a.toStatus).filter(Boolean)).toEqual(['reported', 'under_review', 'action_planned', 'closed']);
    expect((await call(admin, 'PATCH', `/quality/incidents/${inc.id}`, { note: 'late' })).json().error.code).toBe('incident_closed');

    const events = await app.get(DbService).asTenant({ tenantId }, (tx) =>
      tx.execute<{ topic: string; payload: Record<string, unknown> }>(
        sql`select topic, payload from audit.outbox where payload->>'incidentId' = ${inc.id} order by created_at`,
      ),
    );
    expect(events.rows.map((r) => r.topic)).toEqual(['quality.incident.reported', 'quality.incident.closed']);
    expect(events.rows[0]!.payload).toMatchObject({ category: 'medication_error', severity: 'mild', facilityId });
  });

  it('stores anonymous reports with no trace of the reporter', async () => {
    const inc = await ok(doctor, 'POST', '/quality/incidents', incident({ kind: 'near_miss', category: 'wrong_patient', anonymous: true, description: `Anon ${tag}` }));
    expect(inc).toMatchObject({ isAnonymous: true, reportedBy: null });
    const full = await ok(admin, 'GET', `/quality/incidents/${inc.id}`);
    expect(full.reportedBy).toBeNull();
    expect(full.activity[0].actor).toBeNull();
    const trail = await app.get(DbService).asTenant({ tenantId }, (tx) =>
      tx.execute<{ actor_id: string | null; created_by: string | null }>(
        sql`select a.actor_id, i.created_by from audit.audit_log a join quality.incidents i on i.id = a.record_id
            where a.record_id = ${inc.id} and a.table_name = 'quality.incidents'`,
      ),
    );
    expect(trail.rows).toEqual([{ actor_id: null, created_by: null }]);
    const mine = await ok(doctor, 'GET', '/quality/incidents/mine?pageSize=200');
    expect(mine.items.map((i: { id: string }) => i.id)).not.toContain(inc.id);
  });

  it('gives the quality manager the review queue', async () => {
    const qm = (await login(app, 'quality@demo.hms')).accessToken;
    const inc = await ok(reception, 'POST', '/quality/incidents', incident({ category: 'patient_fall', description: `QM ${tag}` }));
    const list = await ok(qm, 'GET', `/quality/incidents?q=${encodeURIComponent(`QM ${tag}`)}`);
    expect(list.items.map((i: { id: string }) => i.id)).toEqual([inc.id]);
    expect((await ok(qm, 'PATCH', `/quality/incidents/${inc.id}`, { status: 'under_review' })).status).toBe('under_review');
    expect((await call(qm, 'GET', '/quality/dashboard')).statusCode).toBe(200);
  });

  it('validates reports', async () => {
    const future = await call(nurse, 'POST', '/quality/incidents', incident({ occurredAt: new Date(Date.now() + 86_400_000).toISOString() }));
    expect(future.statusCode).toBe(400);
    const badPatient = await call(nurse, 'POST', '/quality/incidents', incident({ patientId: randomUUID() }));
    expect(badPatient.statusCode).toBe(404);
  });
});

describe('quality: complaints', () => {
  it('registers with a TAT, resolves with a note, reopens and closes', async () => {
    const c = await ok(reception, 'POST', '/quality/complaints', {
      source: 'walk_in',
      category: 'waiting_time',
      priority: 'high',
      patientId,
      complainantName: `Ramesh ${tag}`,
      complainantMobile: '9876543210',
      description: 'Waited 2 hours for consultation',
    });
    expect(c.complaintNo).toMatch(/^CM\d{6}$/);
    const tatHours = (new Date(c.dueAt).getTime() - new Date(c.createdAt).getTime()) / 3_600_000;
    expect(Math.round(tatHours)).toBe(24);
    expect(c.overdue).toBe(false);

    expect((await call(reception, 'GET', `/quality/complaints/${c.id}`)).statusCode).toBe(403);
    expect((await call(reception, 'PATCH', `/quality/complaints/${c.id}`, { status: 'in_progress' })).statusCode).toBe(403);

    await ok(admin, 'PATCH', `/quality/complaints/${c.id}`, { status: 'in_progress', assignedTo: adminId });
    expect((await call(admin, 'PATCH', `/quality/complaints/${c.id}`, { status: 'resolved' })).json().error.code).toBe('note_required');
    const resolved = await ok(admin, 'PATCH', `/quality/complaints/${c.id}`, { status: 'resolved', resolution: 'Apologised; added a second OPD counter' });
    expect(resolved).toMatchObject({ status: 'resolved', withinTat: true });
    const reopened = await ok(admin, 'PATCH', `/quality/complaints/${c.id}`, { status: 'in_progress', note: 'Patient not satisfied' });
    expect(reopened.resolvedAt).toBeNull();
    await ok(admin, 'PATCH', `/quality/complaints/${c.id}`, { status: 'resolved', resolution: 'Called back, doctor apologised' });
    const closed = await ok(admin, 'PATCH', `/quality/complaints/${c.id}`, { status: 'closed' });
    expect(closed.status).toBe('closed');
    expect((await call(admin, 'PATCH', `/quality/complaints/${c.id}`, { note: 'x' })).statusCode).toBe(409);

    const list = await ok(owner, 'GET', `/quality/complaints?q=${encodeURIComponent(`Ramesh ${tag}`)}`);
    expect(list.items.map((i: { id: string }) => i.id)).toEqual([c.id]);
  });
});

describe('quality: infection control and indicators', () => {
  it('computes CAUTI and SSI rates from confirmed cases and the census', async () => {
    const before = { cauti: await indicator('HIC-CAUTI'), ssi: await indicator('HIC-SSI') };
    // A ward only this test run uses, so the census upsert adds exactly these device days.
    const ward = `ICU-${tag}`;
    await ok(nurse, 'PUT', '/quality/census', { day: today(), ward, patientDays: 10, catheterDays: 250, surgeries: 40 }, 200);
    // Upsert: re-entering the same ward-day replaces the numbers.
    const census = await ok(nurse, 'PUT', '/quality/census', { day: today(), ward, patientDays: 12, catheterDays: 500, surgeries: 50 }, 200);
    expect(census).toMatchObject({ ward, catheterDays: 500, surgeries: 50 });

    const cauti = await ok(nurse, 'POST', '/quality/hai', { patientId, infectionType: 'cauti', ward, onsetDate: today(), organism: 'E. coli' });
    expect(cauti).toMatchObject({ status: 'suspected', caseNo: expect.stringMatching(/^HAI\d{5}$/) });
    // Suspected cases do not count; confirming does.
    expect((await indicator('HIC-CAUTI')).numerator).toBe(before.cauti.numerator);
    await ok(nurse, 'PATCH', `/quality/hai/${cauti.id}`, { status: 'confirmed' });
    await ok(nurse, 'POST', '/quality/hai', { patientId, infectionType: 'ssi', onsetDate: today(), procedureName: 'LSCS', status: 'confirmed' });

    const after = { cauti: await indicator('HIC-CAUTI'), ssi: await indicator('HIC-SSI') };
    expect(after.cauti.numerator! - before.cauti.numerator!).toBe(1);
    expect(after.cauti.denominator! - (before.cauti.denominator ?? 0)).toBe(500);
    expect(after.ssi.numerator! - before.ssi.numerator!).toBe(1);
    expect(after.ssi.denominator! - (before.ssi.denominator ?? 0)).toBe(50);

    const bad = await call(nurse, 'POST', '/quality/hai', { patientId, infectionType: 'clabsi', onsetDate: today(), deviceInsertedOn: '2099-01-01' });
    expect(bad.json().error.code).toBe('invalid_dates');
    expect((await call(reception, 'POST', '/quality/hai', { patientId, infectionType: 'vap', onsetDate: today() })).statusCode).toBe(403);
    expect((await call(doctor, 'GET', '/quality/hai')).statusCode).toBe(200);
  });

  it('takes patient and device days from IPD census events, with manual entry as the fallback', async () => {
    // A past day this run owns, so only these rows count for it (indicators sum the whole month).
    const day = new Date(Date.now() + IST - (2 + Math.floor(Math.random() * 20)) * 86_400_000).toISOString().slice(0, 10);
    const otherFacility = randomUUID();
    const before = (await indicator('HIC-CAUTI')).denominator ?? 0;
    const sameMonth = day.slice(0, 7) === period();
    const wardA = `IPD-A-${tag}`;
    // A manual whole-facility entry made before IPD reported: replaced by IPD's wards for that day.
    await ok(nurse, 'PUT', '/quality/census', { day, ward: `Manual-${tag}`, patientDays: 5, catheterDays: 999, surgeries: 3 }, 200);
    const event = {
      id: randomUUID(),
      tenantId,
      topic: 'ipd.census.daily',
      payload: {
        facilityId,
        date: day,
        wards: [
          { wardId: randomUUID(), wardName: wardA, wardType: 'icu', patientDays: 8, catheterDays: 6, centralLineDays: 2, ventilatorDays: 3, admissions: 1, discharges: 0, surgeries: null },
          { wardId: randomUUID(), wardName: `IPD-B-${tag}`, wardType: 'general', patientDays: 20, catheterDays: 4, centralLineDays: 0, ventilatorDays: 0, admissions: 3, discharges: 2, surgeries: null },
        ],
      },
      createdAt: new Date().toISOString(),
    };
    const bus = app.get(EventBus);
    await bus.dispatch(event);
    await bus.dispatch({ ...event, id: randomUUID() }); // redelivery / replay changes nothing
    // An event for a facility nobody here selected stays out of this facility's figures.
    await bus.dispatch({ ...event, id: randomUUID(), payload: { ...event.payload, facilityId: otherFacility } });

    const rows = (await ok(nurse, 'GET', `/quality/census?from=${day}&to=${day}`)) as { ward: string; source: string; catheterDays: number }[];
    const mine = rows.filter((r) => r.ward.endsWith(tag)).sort((a, b) => a.ward.localeCompare(b.ward));
    expect(mine.map((r) => [r.ward, r.source, r.catheterDays])).toEqual([
      [wardA, 'ipd', 6],
      [`IPD-B-${tag}`, 'ipd', 4],
      [`Manual-${tag}`, 'manual', 999],
    ]);

    // Editing an IPD ward by hand only adds surgeries; IPD's device days stay.
    const edited = await ok(nurse, 'PUT', '/quality/census', { day, ward: wardA, patientDays: 1, catheterDays: 1, surgeries: 2 }, 200);
    expect(edited).toMatchObject({ source: 'ipd', patientDays: 8, catheterDays: 6, surgeries: 2 });

    if (sameMonth) {
      // IPD rows win for that day: 6 + 4 catheter days, not the manual 999.
      expect(((await indicator('HIC-CAUTI')).denominator ?? 0) - before).toBe(10);
      // Surgeries come from every row: 3 manual + 2 on the IPD ward.
    }
    const ssi = await ok(admin, 'GET', `/quality/indicators/HIC-SSI/trend?months=1&to=${day.slice(0, 7)}`);
    expect(ssi[0].denominator).toBeGreaterThanOrEqual(5);
  });

  it('counts prescriptions from emr events once each and divides medication errors by them', async () => {
    const before = await indicator('PSQ-ME');
    const bus = app.get(EventBus);
    const event = {
      id: randomUUID(),
      tenantId,
      topic: 'emr.prescription.created',
      payload: { prescriptionId: randomUUID(), patientId, doctorId: adminId, lines: [] },
      createdAt: new Date().toISOString(),
    };
    await bus.dispatch(event);
    await bus.dispatch(event); // redelivery
    await bus.dispatch({ ...event, id: randomUUID() });
    await ok(nurse, 'POST', '/quality/incidents', incident());
    const after = await indicator('PSQ-ME');
    expect(after.denominator! - (before.denominator ?? 0)).toBe(2);
    expect(after.numerator! - before.numerator!).toBe(1);
    expect(after.value).toBeCloseTo((after.numerator! / after.denominator!) * 1000, 1);
  });

  it('accepts monthly values only for manual indicators', async () => {
    const res = await ok(admin, 'PUT', '/quality/indicators/PRE-SAT/values', { period: period(), numerator: 170, denominator: 200, note: tag }, 200);
    expect(res).toMatchObject({ code: 'PRE-SAT', value: 85, status: 'met' });
    expect((await call(admin, 'PUT', '/quality/indicators/HIC-CAUTI/values', { period: period(), numerator: 1, denominator: 2 })).json().error.code).toBe(
      'computed_indicator',
    );
    expect((await call(admin, 'PUT', '/quality/indicators/PRE-SAT/values', { period: '2999-01', numerator: 1, denominator: 2 })).statusCode).toBe(400);
    expect((await call(nurse, 'PUT', '/quality/indicators/PRE-SAT/values', { period: period(), numerator: 1, denominator: 2 })).statusCode).toBe(403);
    const trend = await ok(owner, 'GET', `/quality/indicators/PRE-SAT/trend?months=3`);
    expect(trend.map((t: { period: string }) => t.period).at(-1)).toBe(period());

    const dash = await ok(owner, 'GET', '/quality/dashboard');
    expect(dash.period).toBe(period());
    expect(dash.indicators.length).toBeGreaterThan(15);
    expect(dash.incidentsThisMonth).toBeGreaterThan(0);
  });
});

describe('quality: audits', () => {
  it('scores an audit, lists non-compliances and feeds hand hygiene compliance', async () => {
    const before = await indicator('HIC-HH');
    const items = ['Hand rub at point of care', 'Five moments followed', 'Nails short, no jewellery', 'Gloves changed between patients'];
    expect((await call(nurse, 'POST', '/quality/checklists', { name: `HH ${tag}`, category: 'hand_hygiene', items })).statusCode).toBe(403);
    const cl = await ok(admin, 'POST', '/quality/checklists', { name: `HH ${tag}`, category: 'hand_hygiene', items });
    expect(cl.items.map((i: { id: string }) => i.id)).toEqual(['1', '2', '3', '4']);
    expect((await call(admin, 'POST', '/quality/checklists', { name: `hh ${tag}`, category: 'other', items: ['x'] })).statusCode).toBe(409);
    // Editing keeps ids of unchanged items.
    const edited = await ok(admin, 'PUT', `/quality/checklists/${cl.id}`, { name: `HH ${tag}`, category: 'hand_hygiene', items: [...items.slice(0, 3), 'Gloves removed after each patient'] }, 200);
    expect(edited.items.map((i: { id: string }) => i.id)).toEqual(['1', '2', '3', '5']);

    const audit = await ok(nurse, 'POST', '/quality/audits', { checklistId: cl.id, scheduledOn: today(), department: 'ICU' });
    expect(audit).toMatchObject({ status: 'scheduled', auditor: { id: nurseId }, score: null });
    const partial = await call(nurse, 'POST', `/quality/audits/${audit.id}/submit`, { responses: [{ itemId: '1', result: 'yes' }] });
    expect(partial.json().error.code).toBe('incomplete_audit');
    const done = await ok(
      nurse,
      'POST',
      `/quality/audits/${audit.id}/submit`,
      {
        responses: [
          { itemId: '1', result: 'yes' },
          { itemId: '2', result: 'no', remark: 'Missed moment 4' },
          { itemId: '3', result: 'yes' },
          { itemId: '5', result: 'na' },
        ],
      },
      200,
    );
    expect(done).toMatchObject({ status: 'completed', score: 66.67, nonCompliant: 1 });
    expect(done.items.find((i: { id: string }) => i.id === '2')).toMatchObject({ result: 'no', remark: 'Missed moment 4' });
    expect((await call(nurse, 'POST', `/quality/audits/${audit.id}/submit`, { responses: [{ itemId: '1', result: 'yes' }] })).statusCode).toBe(409);

    const after = await indicator('HIC-HH');
    expect(after.numerator! - (before.numerator ?? 0)).toBeCloseTo(66.67, 2);
    expect(after.denominator! - (before.denominator ?? 0)).toBe(1);

    const capa = await ok(admin, 'POST', '/quality/capas', { sourceType: 'audit', sourceId: audit.id, title: 'Retrain on 5 moments', problem: 'Moment 4 missed', dueDate: today() });
    expect((await ok(owner, 'GET', `/quality/audits/${audit.id}`)).capas.map((c: { id: string }) => c.id)).toEqual([capa.id]);
    expect((await call(admin, 'POST', '/quality/capas', { sourceType: 'audit', title: 'x', problem: 'y', dueDate: today() })).statusCode).toBe(400);
  });
});

describe('quality: NABH documents', () => {
  it('versions documents and shows staff only the approved version', async () => {
    const code = `HIC-POL-${tag}`;
    const v1 = await ok(admin, 'POST', '/quality/documents', { code, title: 'Hand hygiene policy', chapter: 'HIC', docType: 'policy' });
    expect(v1).toMatchObject({ status: 'draft', version: 1 });
    expect((await call(admin, 'POST', `/quality/documents/${v1.id}/approve`)).json().error.code).toBe('document_empty');
    await ok(admin, 'PATCH', `/quality/documents/${v1.id}`, { content: 'All staff follow the WHO 5 moments.' });
    // Drafts are hidden from staff.
    expect((await call(reception, 'GET', `/quality/documents/${v1.id}`)).statusCode).toBe(404);
    const approved = await ok(admin, 'POST', `/quality/documents/${v1.id}/approve`, undefined, 200);
    expect(approved).toMatchObject({ status: 'approved', effectiveFrom: today(), approvedBy: { id: adminId } });
    expect(approved.reviewDue > today()).toBe(true);
    expect((await call(admin, 'PATCH', `/quality/documents/${v1.id}`, { title: 'x' })).json().error.code).toBe('document_locked');
    expect((await call(admin, 'POST', '/quality/documents', { code, title: 'dup', chapter: 'HIC', docType: 'policy' })).statusCode).toBe(409);

    const v2 = await ok(admin, 'POST', `/quality/documents/${v1.id}/revise`);
    expect(v2).toMatchObject({ status: 'draft', version: 2, content: 'All staff follow the WHO 5 moments.' });
    expect((await call(admin, 'POST', `/quality/documents/${v1.id}/revise`)).json().error.code).toBe('draft_exists');
    await ok(admin, 'PATCH', `/quality/documents/${v2.id}`, { content: 'Updated: alcohol rub preferred.' });
    await ok(admin, 'POST', `/quality/documents/${v2.id}/approve`, undefined, 200);
    const v1Now = await ok(admin, 'GET', `/quality/documents/${v1.id}`);
    expect(v1Now.status).toBe('archived');

    const staffList = await ok(reception, 'GET', `/quality/documents?q=${code}`);
    expect(staffList.items.map((d: { version: number; status: string }) => [d.version, d.status])).toEqual([[2, 'approved']]);
    const staffView = await ok(reception, 'GET', `/quality/documents/${v2.id}`);
    expect(staffView.versions.map((v: { version: number }) => v.version)).toEqual([2]);
    expect((await call(reception, 'POST', `/quality/documents/${v2.id}/archive`)).statusCode).toBe(403);
  });
});

describe('quality: plan entitlement', () => {
  it('refuses quality screens to hospitals whose plan does not include them', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/quality/incidents/mine', headers: bearer(starterHospital) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('plan_upgrade_required');
  });
});

describe('quality: hospital isolation', () => {
  it("never shows or changes one hospital's quality records from another", async () => {
    const inc = await ok(nurse, 'POST', '/quality/incidents', incident({ description: `Isolation ${tag}` }));
    const cmp = await ok(reception, 'POST', '/quality/complaints', { source: 'phone', category: 'billing', complainantName: `Iso ${tag}`, description: 'Overcharged' });
    const capa = await ok(admin, 'POST', '/quality/capas', { sourceType: 'complaint', sourceId: cmp.id, title: 'Bill review', problem: 'Overcharge', dueDate: today() });

    // The other hospital's admin holds every quality permission and its plan includes quality,
    // so these reach the database and RLS hides demo's rows.
    const city = (method: string, url: string, payload?: unknown) =>
      app.inject({ method, url: `/api/v1${url}`, headers: bearer(otherHospital), payload } as Inject);
    expect((await city('GET', `/quality/incidents/${inc.id}`)).statusCode).toBe(404);
    expect((await city('PATCH', `/quality/incidents/${inc.id}`, { status: 'under_review' })).statusCode).toBe(404);
    expect((await city('GET', `/quality/complaints/${cmp.id}`)).statusCode).toBe(404);
    expect((await city('PATCH', `/quality/capas/${capa.id}`, { status: 'cancelled', note: 'x' })).statusCode).toBe(404);
    expect((await city('GET', `/quality/incidents?q=${encodeURIComponent(`Isolation ${tag}`)}`)).json().items).toEqual([]);
    // Another hospital's CAPA cannot point at demo's complaint, and city cannot attach demo's patient.
    expect((await city('POST', '/quality/capas', { sourceType: 'complaint', sourceId: cmp.id, title: 'x', problem: 'y', dueDate: today() })).statusCode).toBe(404);
    expect((await city('POST', '/quality/hai', { patientId, infectionType: 'vap', onsetDate: today() })).statusCode).toBe(404);

    const still = await ok(admin, 'GET', `/quality/incidents/${inc.id}`);
    expect(still.status).toBe('reported');
  });
});

describe('quality: editing records', () => {
  it('edits an infection case: fields, clearing the device date, date rules and permissions', async () => {
    const h = await ok(nurse, 'POST', '/quality/hai', { patientId, infectionType: 'clabsi', ward: 'ICU', onsetDate: today(), deviceInsertedOn: today() });
    const edited = await ok(nurse, 'PATCH', `/quality/hai/${h.id}`, { infectionType: 'vap', ward: `MICU ${tag}`, organism: 'Klebsiella', cultureRef: 'CX-1', notes: 'Updated after culture' });
    expect(edited).toMatchObject({ infectionType: 'vap', ward: `MICU ${tag}`, organism: 'Klebsiella', cultureRef: 'CX-1', notes: 'Updated after culture', deviceInsertedOn: today() });
    const cleared = await ok(nurse, 'PATCH', `/quality/hai/${h.id}`, { deviceInsertedOn: null, ward: '' });
    expect(cleared).toMatchObject({ deviceInsertedOn: null, ward: null });

    expect((await call(nurse, 'PATCH', `/quality/hai/${h.id}`, { onsetDate: '2099-01-01' })).json().error.code).toBe('future_date');
    expect((await call(nurse, 'PATCH', `/quality/hai/${h.id}`, { deviceInsertedOn: '2099-01-01' })).json().error.code).toBe('invalid_dates');
    expect((await call(nurse, 'PATCH', `/quality/hai/${h.id}`, { onsetDate: 'yesterday' })).statusCode).toBe(400);
    expect((await call(nurse, 'PATCH', `/quality/hai/${h.id}`, { infectionType: 'flu' })).statusCode).toBe(400);
    expect((await call(doctor, 'PATCH', `/quality/hai/${h.id}`, { organism: 'x' })).statusCode).toBe(403);
  });

  it('re-files a complaint under another category and department', async () => {
    const c = await ok(reception, 'POST', '/quality/complaints', {
      source: 'phone',
      category: 'waiting_time',
      complainantName: `Edit ${tag}`,
      description: 'Filed under the wrong category',
    });
    const res = await ok(admin, 'PATCH', `/quality/complaints/${c.id}`, { category: 'billing', department: 'Accounts' });
    expect(res).toMatchObject({ category: 'billing', department: 'Accounts', status: c.status });
    expect((await call(admin, 'PATCH', `/quality/complaints/${c.id}`, { category: 'nonsense' })).statusCode).toBe(400);
    expect((await call(reception, 'PATCH', `/quality/complaints/${c.id}`, { category: 'billing' })).statusCode).toBe(403);
  });
});
