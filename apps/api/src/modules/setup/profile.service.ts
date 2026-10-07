import { Injectable } from '@nestjs/common';
import {
  and,
  counters,
  eq,
  facilities,
  formatSeries,
  iso,
  isNull,
  nextCounter,
  setupHospitalProfiles,
  setupNumberSeries,
  setupPrintTemplates,
  sql,
  tenants,
  type Tx,
} from '@hms/db';
import { setup as S } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { badRequest } from '../../common/errors/errors';
import { ctx } from './setup.util';

type ProfileRow = typeof setupHospitalProfiles.$inferSelect;
type TemplateRow = typeof setupPrintTemplates.$inferSelect;

/** Hospital profile/letterhead, the setup wizard, number series and print templates. */
@Injectable()
export class ProfileService {
  constructor(private readonly db: DbService) {}

  // ---------- profile ----------

  getProfile(): Promise<S.HospitalProfile> {
    return this.db.tx((tx) => this.readProfile(tx));
  }

  /** Profile for other modules (letterhead, GSTIN on invoices) inside their own transaction. */
  async readProfile(tx: Tx): Promise<S.HospitalProfile> {
    const [row] = await tx.select().from(setupHospitalProfiles).limit(1);
    if (row) return profileDto(row);
    const [tenant] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, ctx().tenantId)).limit(1);
    return {
      legalName: tenant?.name ?? '',
      displayName: tenant?.name ?? '',
      gstin: null,
      pan: null,
      registrationNo: null,
      accreditation: null,
      phone: null,
      email: null,
      website: null,
      address: null,
      logoUrl: null,
      letterhead: null,
      timezone: 'Asia/Kolkata',
      setupCompletedAt: null,
      updatedAt: null,
    };
  }

  upsertProfile(input: S.UpsertProfile): Promise<S.HospitalProfile> {
    const c = ctx();
    const values = {
      legalName: input.legalName,
      displayName: input.displayName,
      gstin: input.gstin ?? null,
      pan: input.pan ?? null,
      registrationNo: input.registrationNo ?? null,
      accreditation: input.accreditation ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      website: input.website ?? null,
      address: (input.address as Record<string, string> | undefined) ?? null,
      logoUrl: input.logoUrl ?? null,
      letterhead: (input.letterhead as Record<string, string> | undefined) ?? null,
      timezone: input.timezone ?? 'Asia/Kolkata',
      updatedBy: c.userId,
    };
    return this.db.tx(async (tx) => {
      await assertTimezone(tx, values.timezone);
      const [row] = await tx
        .insert(setupHospitalProfiles)
        .values({ ...values, tenantId: c.tenantId, createdBy: c.userId })
        .onConflictDoUpdate({ target: setupHospitalProfiles.tenantId, set: values })
        .returning();
      return profileDto(row!);
    });
  }

  // ---------- wizard ----------

  wizardStatus(): Promise<S.WizardStatus> {
    return this.db.tx(async (tx) => {
      const res = await tx.execute<{
        profile: number;
        facilities: number;
        departments: number;
        staff: number;
        doctors: number;
        schedules: number;
        completed_at: string | null;
      }>(sql`
        select
          (select count(*)::int from setup.hospital_profiles) as profile,
          (select count(*)::int from setup.facilities where is_active) as facilities,
          (select count(*)::int from setup.departments where is_active) as departments,
          (select count(*)::int from iam.users where status <> 'disabled') as staff,
          (select count(distinct u.id)::int from iam.users u
             left join iam.user_roles ur on ur.tenant_id = u.tenant_id and ur.user_id = u.id
             left join iam.roles r on r.tenant_id = ur.tenant_id and r.id = ur.role_id
             left join setup.staff_profiles sp on sp.tenant_id = u.tenant_id and sp.user_id = u.id
            where u.status = 'active' and (r.key = 'doctor' or sp.staff_type = 'doctor')) as doctors,
          (select count(distinct user_id)::int from setup.doctor_schedules) as schedules,
          (select to_char(setup_completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from setup.hospital_profiles limit 1) as completed_at`);
      const r = res.rows[0]!;
      const steps: S.WizardStatus['steps'] = [
        { key: 'profile', label: 'Hospital profile & GSTIN', done: r.profile > 0, count: r.profile, href: '/setup/profile' },
        { key: 'facilities', label: 'Facilities / branches', done: r.facilities > 0, count: r.facilities, href: '/setup/facilities' },
        { key: 'departments', label: 'Departments', done: r.departments > 0, count: r.departments, href: '/setup/departments' },
        { key: 'staff', label: 'Staff users & roles', done: r.staff > 1, count: r.staff, href: '/setup/users' },
        { key: 'doctors', label: 'Doctors with fees', done: r.doctors > 0, count: r.doctors, href: '/setup/staff' },
        { key: 'schedules', label: 'Doctor OPD timings', done: r.schedules > 0, count: r.schedules, href: '/setup/doctors' },
      ];
      return { steps, completed: r.completed_at !== null, completedAt: r.completed_at };
    });
  }

  completeWizard(): Promise<S.WizardStatus> {
    const c = ctx();
    return this.db
      .tx(async (tx) => {
        const profile = await this.readProfile(tx);
        await tx
          .insert(setupHospitalProfiles)
          .values({
            tenantId: c.tenantId,
            legalName: profile.legalName,
            displayName: profile.displayName,
            setupCompletedAt: sql`now()`,
            createdBy: c.userId,
            updatedBy: c.userId,
          })
          .onConflictDoUpdate({ target: setupHospitalProfiles.tenantId, set: { setupCompletedAt: sql`now()`, updatedBy: c.userId } });
      })
      .then(() => this.wizardStatus());
  }

  // ---------- number series ----------

  listNumberSeries(): Promise<S.NumberSeries[]> {
    return this.db.tx(async (tx) => {
      const [settings, counts] = await Promise.all([tx.select().from(setupNumberSeries), tx.select().from(counters)]);
      const keys = new Set([...Object.keys(S.DEFAULT_NUMBER_SERIES), ...settings.map((s) => s.key), ...counts.map((c) => c.key)]);
      return [...keys].sort().map((key) => {
        const s = settings.find((x) => x.key === key);
        const d = S.DEFAULT_NUMBER_SERIES[key];
        const prefix = s?.prefix ?? d?.prefix ?? '';
        const width = s?.width ?? d?.width ?? 6;
        const nextValue = counts.find((x) => x.key === key)?.nextValue ?? 1;
        return { key, label: d?.label ?? key, prefix, width, nextValue, preview: formatSeries(prefix, nextValue, width) };
      });
    });
  }

  updateNumberSeries(key: string, input: S.UpdateNumberSeries): Promise<S.NumberSeries> {
    const c = ctx();
    if (!/^[a-z][a-z0-9_.]{1,60}$/.test(key)) throw badRequest('invalid_series', 'Unknown number series');
    return this.db
      .tx(async (tx) => {
        await tx
          .insert(setupNumberSeries)
          .values({ tenantId: c.tenantId, key, prefix: input.prefix, width: input.width, createdBy: c.userId, updatedBy: c.userId })
          .onConflictDoUpdate({
            target: [setupNumberSeries.tenantId, setupNumberSeries.key],
            set: { prefix: input.prefix, width: input.width, updatedBy: c.userId },
          });
        if (input.nextValue !== undefined) {
          const [cur] = await tx.select().from(counters).where(eq(counters.key, key)).for('update');
          if (cur && input.nextValue < cur.nextValue) {
            throw badRequest('series_backwards', `Next number cannot go back below ${cur.nextValue}; numbers must never repeat`);
          }
          await tx
            .insert(counters)
            .values({ tenantId: c.tenantId, key, nextValue: input.nextValue })
            .onConflictDoUpdate({ target: [counters.tenantId, counters.key], set: { nextValue: input.nextValue, updatedAt: sql`now()` } });
        }
      })
      .then(() => this.listNumberSeries())
      .then((all) => all.find((s) => s.key === key)!);
  }

  /** Next formatted number for a series, using the hospital's prefix/width. Call inside the caller's tx. */
  async nextNumber(tx: Tx, key: string, fallback: { prefix: string; width?: number }): Promise<string> {
    const n = await nextCounter(tx, key);
    const [s] = await tx.select().from(setupNumberSeries).where(eq(setupNumberSeries.key, key)).limit(1);
    return formatSeries(s?.prefix ?? fallback.prefix, n, s?.width ?? fallback.width ?? 6);
  }

  // ---------- print templates ----------

  listPrintTemplates(facilityId?: string): Promise<S.PrintTemplate[]> {
    return this.db.tx((tx) => Promise.all(S.PRINT_TEMPLATE_KEYS.map((k) => this.readPrintTemplate(tx, k, facilityId))));
  }

  getPrintTemplate(key: S.PrintTemplateKey, facilityId?: string): Promise<S.PrintTemplate> {
    return this.db.tx((tx) => this.readPrintTemplate(tx, key, facilityId));
  }

  /** Facility-specific template, else the hospital-wide one, else defaults. */
  async readPrintTemplate(tx: Tx, key: S.PrintTemplateKey, facilityId?: string | null): Promise<S.PrintTemplate> {
    const rows = await tx
      .select()
      .from(setupPrintTemplates)
      .where(and(eq(setupPrintTemplates.key, key), facilityId ? sql`(${setupPrintTemplates.facilityId} = ${facilityId} or ${setupPrintTemplates.facilityId} is null)` : isNull(setupPrintTemplates.facilityId)));
    const row = rows.find((r) => r.facilityId) ?? rows[0];
    if (row) return templateDto(row);
    return {
      key,
      facilityId: null,
      paperSize: key === 'receipt' ? 'thermal_80mm' : key === 'prescription' ? 'A5' : 'A4',
      showLogo: true,
      showLetterhead: true,
      headerText: null,
      footerText: null,
      marginTopMm: 10,
      marginBottomMm: 10,
      saved: false,
    };
  }

  upsertPrintTemplate(key: S.PrintTemplateKey, input: S.UpsertPrintTemplate): Promise<S.PrintTemplate> {
    const c = ctx();
    const facilityId = input.facilityId ?? null;
    const values = {
      paperSize: input.paperSize ?? 'A4',
      showLogo: input.showLogo ?? true,
      showLetterhead: input.showLetterhead ?? true,
      headerText: input.headerText || null,
      footerText: input.footerText || null,
      marginTopMm: input.marginTopMm ?? 10,
      marginBottomMm: input.marginBottomMm ?? 10,
      updatedBy: c.userId,
    };
    return this.db.tx(async (tx) => {
      if (facilityId) {
        const [f] = await tx.select({ id: facilities.id }).from(facilities).where(eq(facilities.id, facilityId)).limit(1);
        if (!f) throw badRequest('invalid_facility', 'Facility not found');
      }
      const where = and(
        eq(setupPrintTemplates.key, key),
        facilityId ? eq(setupPrintTemplates.facilityId, facilityId) : isNull(setupPrintTemplates.facilityId),
      );
      const [existing] = await tx.select({ id: setupPrintTemplates.id }).from(setupPrintTemplates).where(where).limit(1);
      const [row] = existing
        ? await tx.update(setupPrintTemplates).set(values).where(eq(setupPrintTemplates.id, existing.id)).returning()
        : await tx
            .insert(setupPrintTemplates)
            .values({ ...values, tenantId: c.tenantId, key, facilityId, createdBy: c.userId })
            .returning();
      return templateDto(row!);
    });
  }
}

async function assertTimezone(tx: Tx, tz: string) {
  const res = await tx.execute<{ ok: boolean }>(sql`select exists (select 1 from pg_timezone_names where name = ${tz}) as ok`);
  if (!res.rows[0]?.ok) throw badRequest('invalid_timezone', `Unknown timezone ${tz}`);
}

function profileDto(r: ProfileRow): S.HospitalProfile {
  return {
    legalName: r.legalName,
    displayName: r.displayName,
    gstin: r.gstin,
    pan: r.pan,
    registrationNo: r.registrationNo,
    accreditation: r.accreditation,
    phone: r.phone,
    email: r.email,
    website: r.website,
    address: r.address,
    logoUrl: r.logoUrl,
    letterhead: r.letterhead,
    timezone: r.timezone,
    setupCompletedAt: iso(r.setupCompletedAt),
    updatedAt: iso(r.updatedAt),
  };
}

function templateDto(r: TemplateRow): S.PrintTemplate {
  return {
    key: r.key as S.PrintTemplateKey,
    facilityId: r.facilityId,
    paperSize: r.paperSize as S.PrintTemplate['paperSize'],
    showLogo: r.showLogo,
    showLetterhead: r.showLetterhead,
    headerText: r.headerText,
    footerText: r.footerText,
    marginTopMm: r.marginTopMm,
    marginBottomMm: r.marginBottomMm,
    saved: true,
  };
}
