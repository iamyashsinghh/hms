import { ALL_MODULES, SYSTEM_ROLES, SYSTEM_ROLE_KEYS, defaultPermissionsForRole } from '@hms/shared';
import type { ClientBase } from 'pg';
import { hashPassword } from './password';

/** Upsert the global permission catalog from every module manifest. Needs the migrator role. */
export async function syncPermissionCatalog(client: ClientBase): Promise<number> {
  let n = 0;
  for (const m of ALL_MODULES) {
    for (const p of m.permissions) {
      await client.query(
        `INSERT INTO iam.permissions (key, module, description) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET module = EXCLUDED.module, description = EXCLUDED.description`,
        [p.key, m.key, p.description],
      );
      n++;
    }
  }
  return n;
}

export interface ProvisionTenantInput {
  code: string;
  name: string;
  plan?: string;
  facility: { code: string; name: string; type?: string };
  admin: { name: string; email?: string; mobile?: string; password: string };
}

/**
 * Create (or top up) a hospital: tenant row, first facility, system roles with their default
 * permissions, and the first admin user. Idempotent. Runs in the caller's transaction.
 */
export async function provisionTenant(client: ClientBase, input: ProvisionTenantInput): Promise<{ tenantId: string; adminId: string; facilityId: string }> {
  const t = await client.query<{ id: string }>(
    `INSERT INTO platform.tenants (code, name, plan) VALUES ($1, $2, $3)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [input.code, input.name, input.plan ?? 'starter'],
  );
  const tenantId = t.rows[0]!.id;
  await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

  const f = await client.query<{ id: string }>(
    `INSERT INTO setup.facilities (tenant_id, code, name, type) VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [tenantId, input.facility.code, input.facility.name, input.facility.type ?? 'hospital'],
  );
  const facilityId = f.rows[0]!.id;

  await syncSystemRoles(client, tenantId);

  const admin = await upsertUser(client, tenantId, { ...input.admin, roleKeys: ['hospital_admin'] });
  return { tenantId, adminId: admin, facilityId };
}

/** Make sure every system role exists for the tenant and has at least its default permissions. */
export async function syncSystemRoles(client: ClientBase, tenantId: string): Promise<void> {
  for (const key of SYSTEM_ROLE_KEYS) {
    const r = await client.query<{ id: string }>(
      `INSERT INTO iam.roles (tenant_id, key, name, is_system) VALUES ($1, $2, $3, true)
       ON CONFLICT (tenant_id, key) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [tenantId, key, SYSTEM_ROLES[key]],
    );
    const roleId = r.rows[0]!.id;
    const perms = defaultPermissionsForRole(key);
    if (perms.length) {
      await client.query(
        `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_key)
         SELECT $1, $2, unnest($3::text[]) ON CONFLICT DO NOTHING`,
        [tenantId, roleId, perms],
      );
    }
  }
}

export async function upsertUser(
  client: ClientBase,
  tenantId: string,
  u: { name: string; email?: string; mobile?: string; password: string; roleKeys: string[] },
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM iam.users WHERE tenant_id = $1 AND (lower(email) = lower($2) OR mobile = $3)`,
    [tenantId, u.email ?? null, u.mobile ?? null],
  );
  let userId = existing.rows[0]?.id;
  if (!userId) {
    const ins = await client.query<{ id: string }>(
      `INSERT INTO iam.users (tenant_id, name, email, mobile, password_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenantId, u.name, u.email ?? null, u.mobile ?? null, await hashPassword(u.password)],
    );
    userId = ins.rows[0]!.id;
  }
  await client.query(
    `INSERT INTO iam.user_roles (tenant_id, user_id, role_id)
     SELECT $1, $2, r.id FROM iam.roles r WHERE r.tenant_id = $1 AND r.key = ANY($3::text[])
     ON CONFLICT DO NOTHING`,
    [tenantId, userId, u.roleKeys],
  );
  return userId;
}
