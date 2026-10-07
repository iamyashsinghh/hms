import { Injectable } from '@nestjs/common';
import { eq, provisionTenant, tenants } from '@hms/db';
import {
  RESERVED_TENANT_CODES,
  tenantCodeSchema,
  type BillingCycle,
  type CodeAvailability,
  type SignupResult,
} from './contracts';
import type { PoolClient } from 'pg';
import { badRequest, conflict } from '../../common/errors/errors';
import { PlatformDb } from './platform-db';
import { RateLimiter } from './rate-limit';

export interface CreateHospitalInput {
  hospitalName: string;
  code: string;
  facilityType: 'hospital' | 'clinic' | 'diagnostic_centre' | 'pharmacy';
  city?: string;
  state?: string;
  adminName: string;
  email: string;
  mobile: string;
  password: string;
  planCode: string;
  billingCycle?: BillingCycle;
  /** Overrides the plan's trial length; 0 with startActive. */
  trialDays?: number;
  startActive?: boolean;
  source: 'self_signup' | 'console';
  ip?: string;
}

/** Self-service hospital signup and console-created hospitals. Uses provisionTenant from @hms/db. */
@Injectable()
export class SignupService {
  readonly limiter = new RateLimiter(5, 60 * 60_000);

  constructor(private readonly db: PlatformDb) {}

  async codeAvailability(raw: string): Promise<CodeAvailability> {
    const parsed = tenantCodeSchema.safeParse(raw);
    if (!parsed.success) return { code: raw, available: false, reason: 'invalid' };
    const code = parsed.data;
    if ((RESERVED_TENANT_CODES as readonly string[]).includes(code)) return { code, available: false, reason: 'reserved' };
    const [row] = await this.db.global.select({ id: tenants.id }).from(tenants).where(eq(tenants.code, code)).limit(1);
    return row ? { code, available: false, reason: 'taken' } : { code, available: true };
  }

  async create(input: CreateHospitalInput): Promise<SignupResult & { adminUserId: string }> {
    if ((RESERVED_TENANT_CODES as readonly string[]).includes(input.code)) {
      throw badRequest('code_reserved', 'This hospital code is reserved. Please choose another.');
    }
    return this.db.client(async (client) => {
      const plan = await client.query<{ code: string; trial_days: number; is_public: boolean; is_active: boolean }>(
        'SELECT code, trial_days, is_public, is_active FROM platform.plans WHERE code = $1',
        [input.planCode],
      );
      const p = plan.rows[0];
      if (!p || !p.is_active || (input.source === 'self_signup' && !p.is_public)) {
        throw badRequest('plan_unavailable', 'This plan is not available');
      }
      // Serialise signups for the same code: provisionTenant upserts by code, so a race must never
      // let a second signup "top up" the first hospital.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`platform.tenant:${input.code}`]);
      const exists = await client.query('SELECT 1 FROM platform.tenants WHERE code = $1', [input.code]);
      if (exists.rowCount) throw conflict('code_taken', 'This hospital code is already taken');

      const { tenantId, adminId } = await provisionTenant(client, {
        code: input.code,
        name: input.hospitalName,
        plan: input.planCode,
        facility: { code: 'MAIN', name: input.hospitalName, type: input.facilityType },
        admin: { name: input.adminName, email: input.email, mobile: input.mobile, password: input.password },
      });

      const trialDays = input.startActive ? 0 : (input.trialDays ?? p.trial_days);
      const status = input.startActive || trialDays === 0 ? 'active' : 'trial';
      const cycle = input.billingCycle ?? 'monthly';
      await client.query(
        `UPDATE platform.tenants
            SET status = $2,
                settings = settings || jsonb_build_object('city', $3::text, 'state', $4::text,
                             'signup', jsonb_build_object('source', $5::text, 'ip', $6::text, 'at', now()))
          WHERE id = $1`,
        [tenantId, status, input.city ?? null, input.state ?? null, input.source, input.ip ?? null],
      );
      const sub = await client.query<{ id: string; trial_ends_at: Date | null }>(
        `INSERT INTO platform.subscriptions (tenant_id, plan_code, status, billing_cycle, trial_ends_at, current_period_end)
         VALUES ($1, $2, $3, $4,
                 CASE WHEN $3 = 'trial' THEN now() + make_interval(days => $5) END,
                 CASE WHEN $3 = 'active' THEN now() + (CASE WHEN $4 = 'yearly' THEN interval '1 year' ELSE interval '1 month' END) END)
         RETURNING id, trial_ends_at`,
        [tenantId, input.planCode, status, cycle, trialDays],
      );
      await publish(client, tenantId, 'platform.tenant.signed_up', {
        tenantId,
        code: input.code,
        name: input.hospitalName,
        planCode: input.planCode,
        adminUserId: adminId,
      });
      const trialEndsAt = sub.rows[0]!.trial_ends_at;
      return {
        tenantId,
        adminUserId: adminId,
        code: input.code,
        planCode: input.planCode,
        trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
        loginUrl: `/login?hospital=${encodeURIComponent(input.code)}`,
      };
    });
  }
}

async function publish(client: PoolClient, tenantId: string, topic: string, payload: Record<string, unknown>) {
  // provisionTenant already pointed app.tenant_id at the new hospital, so the outbox RLS check passes.
  await client.query('INSERT INTO audit.outbox (tenant_id, topic, payload) VALUES ($1, $2, $3)', [tenantId, topic, JSON.stringify(payload)]);
}

