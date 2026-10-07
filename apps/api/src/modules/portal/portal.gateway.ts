import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { sql, type Tx } from '@hms/db';
import type { portal } from '@hms/shared';

/**
 * The slice of other modules' services the portal calls (contracts in PARALLEL_PLAN.md section 4).
 * Setup and front office are built in parallel threads, so their services are looked up at startup:
 * when present they are used; until then the portal falls back to its own simple behaviour
 * (doctors = staff with the doctor role, default OPD hours, bookings wait for the front desk).
 * Once both modules have merged, replace the lookup with normal Nest imports.
 */
export interface SetupContract {
  listDoctors(q: { facilityId?: string; departmentId?: string }): Promise<portal.PortalDoctor[]>;
  getDoctorSchedule(userId: string, date: string): Promise<unknown>;
}

export interface FrontofficeContract {
  book(input: { patientId: string; doctorId: string; facilityId: string; slotStart: string; type: string }): Promise<{ id?: string; appointmentId?: string }>;
  /** Not in the wave-1 contract yet; used when present. */
  cancel?(appointmentId: string, input?: { reason?: string }): Promise<unknown>;
}

/** Default OPD hours (IST) used until the setup module provides doctor schedules. */
const DEFAULT_SESSIONS: Array<[string, string]> = [
  ['10:00', '13:00'],
  ['17:00', '20:00'],
];
const SLOT_MINUTES = 15;

@Injectable()
export class PortalGateway implements OnModuleInit {
  private readonly logger = new Logger(PortalGateway.name);
  setup: SetupContract | null = null;
  frontoffice: FrontofficeContract | null = null;

  constructor(private readonly moduleRef: ModuleRef) {}

  async onModuleInit() {
    this.setup = await this.find<SetupContract>('../setup/setup.service', 'SetupService', ['listDoctors', 'getDoctorSchedule']);
    this.frontoffice = await this.find<FrontofficeContract>('../frontoffice/frontoffice.service', 'FrontofficeService', ['book']);
  }

  async listDoctors(tx: Tx, q: { facilityId?: string; departmentId?: string }): Promise<portal.PortalDoctor[]> {
    if (this.setup) return this.setup.listDoctors(q);
    const res = await tx.execute<{ id: string; name: string }>(sql`
      select distinct u.id, u.name
        from iam.users u
        join iam.user_roles ur on ur.tenant_id = u.tenant_id and ur.user_id = u.id
        join iam.roles r on r.tenant_id = ur.tenant_id and r.id = ur.role_id
       where r.key = 'doctor' and u.status = 'active'
       order by u.name`);
    return res.rows.map((r) => ({ userId: r.id, name: r.name, departmentId: null, specialization: null, consultationFee: null }));
  }

  /** Slot start/end pairs (ISO) for a doctor on a date. */
  async slots(doctorId: string, date: string): Promise<Array<{ start: string; end: string; available?: boolean }>> {
    if (this.setup) {
      const raw = await this.setup.getDoctorSchedule(doctorId, date);
      const list = Array.isArray(raw) ? raw : ((raw as { slots?: unknown[] } | null)?.slots ?? []);
      return list
        .map((s) => s as { start?: string; end?: string; available?: boolean })
        .filter((s): s is { start: string; end: string; available?: boolean } => !!s.start && !!s.end);
    }
    const out: Array<{ start: string; end: string }> = [];
    for (const [from, to] of DEFAULT_SESSIONS) {
      let t = new Date(`${date}T${from}:00+05:30`).getTime();
      const stop = new Date(`${date}T${to}:00+05:30`).getTime();
      while (t + SLOT_MINUTES * 60_000 <= stop) {
        out.push({ start: new Date(t).toISOString(), end: new Date(t + SLOT_MINUTES * 60_000).toISOString() });
        t += SLOT_MINUTES * 60_000;
      }
    }
    return out;
  }

  private async find<T>(path: string, exportName: string, methods: string[]): Promise<T | null> {
    try {
      const mod = (await import(path)) as Record<string, unknown>;
      const cls = mod[exportName];
      if (typeof cls !== 'function') return null;
      const svc = this.moduleRef.get(cls as new (...args: unknown[]) => T, { strict: false }) as Record<string, unknown>;
      if (!methods.every((m) => typeof svc[m] === 'function')) return null;
      this.logger.log(`using ${exportName}`);
      return svc as T;
    } catch {
      return null;
    }
  }
}
