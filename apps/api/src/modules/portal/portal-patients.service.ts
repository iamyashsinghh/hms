import { Injectable } from '@nestjs/common';
import { asc, eq, facilities, tenants } from '@hms/db';
import type { Patient, portal } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { forbidden, notFound } from '../../common/errors/errors';
import { PatientsService } from '../patients/patients.service';
import { PortalRepository } from './portal.repository';
import { runAsTenant } from './request-scope';

/**
 * Which hospital patients (clinical.patients) a portal account may see. Patient records are read and
 * created only through PatientsService; this service owns the account <-> patient links.
 */
@Injectable()
export class PortalPatientsService {
  constructor(
    private readonly db: DbService,
    private readonly repo: PortalRepository,
    private readonly patients: PatientsService,
  ) {}

  /** Links every active patient registered with this mobile. The first one becomes 'self'. */
  async linkByMobile(tenantId: string, accountId: string, mobile: string): Promise<void> {
    await runAsTenant(tenantId, async () => {
      const found = await this.patients.search(mobile, 1, 100);
      const matches = found.items.filter((p) => p.mobile === mobile).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      if (!matches.length) return;
      await this.db.tx(async (tx) => {
        const existing = await this.repo.links(tx, accountId);
        let hasSelf = existing.some((l) => l.relation === 'self');
        const known = new Set(existing.map((l) => l.patientId));
        for (const p of matches) {
          if (known.has(p.id)) continue;
          await this.repo.link(tx, { tenantId, accountId, patientId: p.id, relation: hasSelf ? 'other' : 'self' });
          hasSelf = true;
        }
      });
    });
  }

  async me(tenantId: string, accountId: string): Promise<portal.PortalMe> {
    return runAsTenant(tenantId, async () => {
      const { account, links } = await this.db.tx(async (tx) => ({
        account: await this.repo.findAccount(tx, accountId),
        links: await this.repo.links(tx, accountId),
      }));
      if (!account) throw notFound('Account');
      const [tenant] = await this.db.db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
      const patients: portal.PortalPatient[] = [];
      for (const l of links) {
        const p = await this.patients.get(l.patientId).catch(() => null);
        if (p) patients.push(toPortalPatient(p, l.relation as portal.Relation));
      }
      return {
        accountId: account.id,
        mobile: account.mobile,
        name: account.name ?? patients.find((p) => p.relation === 'self')?.firstName ?? null,
        tenantCode: tenant?.code ?? '',
        hospitalName: tenant?.name ?? '',
        patients,
      };
    });
  }

  /** id -> display name of every patient this account may see. */
  async linkedPatients(accountId: string): Promise<Map<string, string>> {
    const links = await this.db.tx((tx) => this.repo.links(tx, accountId));
    const out = new Map<string, string>();
    for (const l of links) {
      const p = await this.patients.get(l.patientId).catch(() => null);
      if (p) out.set(p.id, [p.firstName, p.lastName].filter(Boolean).join(' '));
    }
    return out;
  }

  /** Throws 403 unless the patient is linked to this account; returns the allowed patient ids. */
  async scope(accountId: string, patientId?: string): Promise<Map<string, string>> {
    const linked = await this.linkedPatients(accountId);
    if (patientId && !linked.has(patientId)) throw forbidden('This patient is not linked to your account');
    if (patientId) return new Map([[patientId, linked.get(patientId)!]]);
    return linked;
  }

  /** Registers a new patient at the hospital with the account's mobile and links them. */
  async addFamilyMember(tenantId: string, accountId: string, input: portal.AddFamilyMember): Promise<portal.PortalPatient> {
    const account = await this.db.tx((tx) => this.repo.findAccount(tx, accountId));
    if (!account) throw notFound('Account');
    const links = await this.db.tx((tx) => this.repo.links(tx, accountId));
    const relation = input.relation === 'self' && links.some((l) => l.relation === 'self') ? 'other' : input.relation;
    const p = await this.patients.create({
      firstName: input.firstName,
      lastName: input.lastName,
      gender: input.gender,
      dateOfBirth: input.dateOfBirth,
      ageYears: input.dateOfBirth ? undefined : input.ageYears,
      bloodGroup: input.bloodGroup,
      mobile: account.mobile,
    });
    await this.db.tx((tx) => this.repo.link(tx, { tenantId, accountId, patientId: p.id, relation }));
    return toPortalPatient(p, relation);
  }

  async updateAccount(accountId: string, name: string): Promise<void> {
    await this.db.tx((tx) => this.repo.updateAccount(tx, accountId, { name }));
  }

  async facilities(tenantId: string) {
    return this.db.asTenant({ tenantId }, (tx) =>
      tx
        .select({ id: facilities.id, code: facilities.code, name: facilities.name })
        .from(facilities)
        .where(eq(facilities.isActive, true))
        .orderBy(asc(facilities.name)),
    );
  }
}

function toPortalPatient(p: Patient, relation: portal.Relation): portal.PortalPatient {
  return {
    id: p.id,
    uhid: p.uhid,
    firstName: p.firstName,
    lastName: p.lastName,
    gender: p.gender,
    dateOfBirth: p.dateOfBirth,
    bloodGroup: p.bloodGroup,
    relation,
  };
}
