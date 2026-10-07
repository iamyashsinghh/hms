import { Injectable } from '@nestjs/common';
import { sql } from '@hms/db';
import { DbService } from '../db/db.service';

export interface Principal {
  active: boolean;
  roles: string[];
  permissions: string[];
  facilityIds: string[] | 'all';
}

/** Loads a staff user's roles, permissions and facility scope, and checks the session is still live. */
@Injectable()
export class PrincipalService {
  constructor(private readonly db: DbService) {}

  /** Without a sessionId the session check is skipped (used to build /auth/me). */
  async load(tenantId: string, userId: string, sessionId?: string): Promise<Principal | null> {
    return this.db.asTenant({ tenantId, userId }, async (tx) => {
      const res = await tx.execute<{
        user_status: string;
        tenant_status: string;
        roles: string[];
        perms: string[];
        all_fac: boolean | null;
        fac_ids: string[];
        session_ok: boolean;
      }>(sql`
        select u.status as user_status,
               t.status as tenant_status,
               coalesce(array_agg(distinct r.key) filter (where r.key is not null), '{}') as roles,
               coalesce(array_agg(distinct rp.permission_key) filter (where rp.permission_key is not null), '{}') as perms,
               bool_or(ur.id is not null and ur.facility_id is null) as all_fac,
               coalesce(array_agg(distinct ur.facility_id) filter (where ur.facility_id is not null), '{}') as fac_ids,
               ${sessionId ?? null}::uuid is null or exists (select 1 from iam.refresh_tokens s
                        where s.tenant_id = u.tenant_id and s.session_id = ${sessionId ?? null}::uuid
                          and s.revoked_at is null and s.expires_at > now()) as session_ok
          from iam.users u
          join platform.tenants t on t.id = u.tenant_id
          left join iam.user_roles ur on ur.tenant_id = u.tenant_id and ur.user_id = u.id
          left join iam.roles r on r.tenant_id = ur.tenant_id and r.id = ur.role_id
          left join iam.role_permissions rp on rp.tenant_id = r.tenant_id and rp.role_id = r.id
         where u.id = ${userId}
         group by u.tenant_id, u.id, u.status, t.status`);
      const row = res.rows[0];
      if (!row) return null;
      return {
        active: row.user_status === 'active' && ['trial', 'active', 'grace'].includes(row.tenant_status) && row.session_ok,
        roles: row.roles,
        permissions: row.perms,
        facilityIds: row.all_fac ? 'all' : row.fac_ids,
      };
    });
  }
}
