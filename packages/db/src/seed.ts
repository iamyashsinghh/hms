import { Client } from 'pg';
import { provisionTenant, syncPermissionCatalog, syncSystemRoles, upsertUser } from './provision';

export const DEMO_PASSWORD = 'Demo@12345';

/** Idempotent seed: permission catalog, every tenant's system roles, and two demo hospitals. */
export async function seed(connectionString: string, log: (m: string) => void = console.log): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    const n = await syncPermissionCatalog(client);
    log(`permissions: ${n}`);

    // New permissions reach existing hospitals' system roles.
    const tenants = await client.query<{ id: string }>('SELECT id FROM platform.tenants');
    for (const t of tenants.rows) {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [t.id]);
      await syncSystemRoles(client, t.id);
    }

    const demo = await provisionTenant(client, {
      code: 'demo',
      name: 'Demo Multispeciality Hospital',
      plan: 'growth',
      facility: { code: 'MAIN', name: 'Main Hospital' },
      admin: { name: 'Demo Admin', email: 'admin@demo.hms', mobile: '9000000001', password: DEMO_PASSWORD },
    });
    const staff: Array<[string, string, string, string]> = [
      ['Dr. Asha Rao', 'doctor@demo.hms', '9000000002', 'doctor'],
      ['Ravi Kumar', 'reception@demo.hms', '9000000003', 'receptionist'],
      ['Meena Joshi', 'pharmacy@demo.hms', '9000000004', 'pharmacist'],
      ['Sunil Mehta', 'owner@demo.hms', '9000000005', 'owner'],
      ['Priya Nair', 'nurse@demo.hms', '9000000006', 'nurse'],
      ['Arjun Das', 'billing@demo.hms', '9000000007', 'billing_clerk'],
      ['Kavita Singh', 'lab@demo.hms', '9000000008', 'lab_technician'],
      ['Dr. Vikram Iyer', 'radiology@demo.hms', '9000000009', 'radiologist'],
      ['Anil Yadav', 'store@demo.hms', '9000000010', 'store_keeper'],
      ['Rekha Pillai', 'accounts@demo.hms', '9000000011', 'accountant'],
      ['Sanjay Bose', 'hr@demo.hms', '9000000012', 'hr_manager'],
      ['Nisha Menon', 'quality@demo.hms', '9000000013', 'quality_manager'],
    ];
    for (const [name, email, mobile, role] of staff) {
      await upsertUser(client, demo.tenantId, { name, email, mobile, password: DEMO_PASSWORD, roleKeys: [role] });
    }

    const existing = await client.query('SELECT count(*)::int AS n FROM clinical.patients WHERE tenant_id = $1', [demo.tenantId]);
    if (existing.rows[0].n === 0) {
      const people: Array<[string, string, string, string, string]> = [
        ['Ramesh', 'Sharma', 'male', '1968-04-12', '9810000001'],
        ['Sunita', 'Verma', 'female', '1985-09-23', '9810000002'],
        ['Aarav', 'Patel', 'male', '2016-01-05', '9810000003'],
        ['Fatima', 'Khan', 'female', '1992-11-30', '9810000004'],
        ['Gurpreet', 'Singh', 'male', '1975-06-18', '9810000005'],
      ];
      for (const [first, last, gender, dob, mobile] of people) {
        const c = await client.query<{ v: string }>(
          `INSERT INTO setup.counters (tenant_id, key, next_value) VALUES ($1, 'uhid', 2)
           ON CONFLICT (tenant_id, key) DO UPDATE SET next_value = setup.counters.next_value + 1
           RETURNING next_value - 1 AS v`,
          [demo.tenantId],
        );
        await client.query(
          `INSERT INTO clinical.patients (tenant_id, uhid, first_name, last_name, gender, date_of_birth, mobile, registered_facility_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [demo.tenantId, `UH${String(c.rows[0]!.v).padStart(6, '0')}`, first, last, gender, dob, mobile, demo.facilityId],
        );
      }
    }
    log(`tenant demo: ${demo.tenantId}`);

    const city = await provisionTenant(client, {
      code: 'city',
      name: 'City Care Clinic',
      facility: { code: 'MAIN', name: 'City Care Clinic' },
      admin: { name: 'City Admin', email: 'admin@city.hms', password: DEMO_PASSWORD },
    });
    log(`tenant city: ${city.tenantId}`);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }
}
