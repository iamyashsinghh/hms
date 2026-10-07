import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { iso, type Tx } from '@hms/db';
import { integrations, type Patient, type Paginated } from '@hms/shared';
import { currentContext } from '../../common/context/request-context';
import { DbService } from '../../common/db/db.service';
import { AppError, conflict, notFound } from '../../common/errors/errors';
import { EventBus } from '../../common/events/event-bus';
import { OutboxService } from '../../common/events/outbox.service';
import { PatientsService } from '../patients/patients.service';
import type { AbdmGateway } from './adapters/abdm.gateway';
import { hmacSha256, mask, safeEqual } from './crypto';
import { toFhirPatient } from './fhir';
import { INTEGRATIONS_CONFIG, type IntegrationsConfig } from './integrations.config';
import {
  IntegrationsRepository,
  type AbhaLinkRow,
  type AbhaRequestRow,
  type CareContextRow,
  type ConsentRow,
  type ScanShareRow,
} from './integrations.repository';
import { IntegrationSettingsService } from './settings.service';
import { istToday, runAsTenant } from './tenant-scope';

type AbhaProfile = integrations.AbhaProfile;

const MAX_OTP_ATTEMPTS = 5;
export const ABDM_SIGNATURE_HEADER = 'x-abdm-signature';

/** Records other modules publish that become ABDM care contexts (HIP side). */
const CARE_CONTEXT_SOURCES = [
  { topic: 'emr.encounter.signed', prefix: 'OPD', module: 'emr', hiTypes: ['OPConsultation', 'Prescription'], idKey: 'encounterId', label: 'OP consultation' },
  { topic: 'lab.report.verified', prefix: 'LAB', module: 'lab', hiTypes: ['DiagnosticReport'], idKey: 'reportId', label: 'Lab report' },
  { topic: 'radiology.report.finalized', prefix: 'RAD', module: 'radiology', hiTypes: ['DiagnosticReport'], idKey: 'reportId', label: 'Radiology report' },
] as const;

/**
 * ABDM: ABHA create/verify and linking, Scan-and-Share, HIP care contexts, HIU consent requests and FHIR.
 * All gateway traffic goes through the AbdmGateway adapter chosen in settings.
 */
@Injectable()
export class AbdmService implements OnModuleInit {
  private readonly logger = new Logger(AbdmService.name);

  constructor(
    private readonly db: DbService,
    private readonly repo: IntegrationsRepository,
    private readonly settings: IntegrationSettingsService,
    private readonly patients: PatientsService,
    private readonly outbox: OutboxService,
    private readonly bus: EventBus,
    @Inject(INTEGRATIONS_CONFIG) private readonly config: IntegrationsConfig,
  ) {}

  onModuleInit() {
    for (const src of CARE_CONTEXT_SOURCES) {
      this.bus.on<Record<string, string>>(src.topic, (e) =>
        runAsTenant(e.tenantId, () =>
          this.addCareContext({
            patientId: e.payload.patientId,
            reference: `${src.prefix}-${e.payload[src.idKey]}`,
            display: `${e.payload.title || src.label} ${istToday(new Date(e.payload.issuedAt || e.createdAt))}`,
            hiTypes: [...src.hiTypes],
            sourceModule: src.module,
            sourceRefId: e.payload[src.idKey] ?? null,
          }).then(() => undefined),
        ),
      );
    }
  }

  // =====================================================================
  // ABHA: OTP create / verify, link to patient
  // =====================================================================

  async requestOtp(input: integrations.AbhaOtpRequest): Promise<integrations.AbhaRequest> {
    const d = integrations.abhaOtpRequestSchema.parse(input);
    if (d.patientId) await this.patients.get(d.patientId);
    const ctx = currentContext()!;
    const { gateway } = await this.db.tx((tx) => this.settings.abdm(tx));
    const otp = await gateway.requestOtp({ purpose: d.purpose, method: d.method, identifier: d.identifier });
    return this.db.tx(async (tx) => {
      const id = d.identifier.replace(/[\s-]/g, '');
      const row = await this.repo.insertAbhaRequest(tx, {
        purpose: d.purpose,
        method: d.method,
        // Aadhaar and mobile are masked; an ABHA address is not secret and is kept as typed.
        identifierMasked: d.method === 'abha' && id.includes('@') ? id.toLowerCase() : mask(id),
        gatewayTxnId: otp.txnId,
        sentTo: otp.sentTo,
        expiresAt: new Date(Date.now() + otp.expiresInSeconds * 1000).toISOString(),
        patientId: d.patientId ?? null,
        createdBy: ctx.userId ?? null,
        updatedBy: ctx.userId ?? null,
      });
      return abhaRequestDto(row);
    });
  }

  async verifyOtp(input: integrations.AbhaOtpVerify): Promise<integrations.AbhaRequest> {
    const d = integrations.abhaOtpVerifySchema.parse(input);
    const first = await this.db.tx((tx) => this.repo.abhaRequest(tx, d.requestId));
    if (!first) throw notFound('ABHA request');
    const nameHint = first.patientId ? displayName(await this.patients.get(first.patientId)) : null;
    let failure: unknown;
    const row = await this.db.tx(async (tx) => {
      const req = await this.repo.abhaRequest(tx, d.requestId, true);
      if (!req) throw notFound('ABHA request');
      if (req.status === 'verified') return req;
      if (req.status !== 'otp_sent') throw conflict('otp_closed', 'This OTP request is closed; request a new OTP');
      if (new Date(req.expiresAt).getTime() < Date.now()) {
        failure = conflict('otp_expired', 'The OTP has expired; request a new one');
        return this.repo.updateAbhaRequest(tx, req.id, { status: 'expired' });
      }
      const { gateway } = await this.settings.abdm(tx);
      try {
        const profile = await gateway.verifyOtp({ txnId: req.gatewayTxnId, otp: d.otp, nameHint });
        return this.repo.updateAbhaRequest(tx, req.id, { status: 'verified', profile, attempts: req.attempts + 1, updatedBy: currentContext()?.userId ?? null });
      } catch (e) {
        // Keep the attempt count (the transaction must commit), then report the error.
        failure = e;
        const attempts = req.attempts + 1;
        return this.repo.updateAbhaRequest(tx, req.id, { attempts, status: attempts >= MAX_OTP_ATTEMPTS ? 'failed' : 'otp_sent' });
      }
    });
    if (failure) throw failure;
    return abhaRequestDto(row);
  }

  async link(input: integrations.AbhaLinkInput): Promise<integrations.AbhaLink> {
    const d = integrations.abhaLinkSchema.parse(input);
    const patient = await this.patients.get(d.patientId);
    const link = await this.db.tx(async (tx) => {
      const req = await this.repo.abhaRequest(tx, d.requestId, true);
      if (!req) throw notFound('ABHA request');
      if (req.status !== 'verified' || !req.profile) throw conflict('abha_not_verified', 'Verify the OTP before linking');
      if (req.patientId && req.patientId !== d.patientId) throw conflict('abha_request_other_patient', 'This ABHA was verified for a different patient');
      const row = await this.createLink(tx, d.patientId, req.profile as AbhaProfile, req.method as integrations.AbhaOtpMethod, req.id);
      if (!req.patientId) await this.repo.updateAbhaRequest(tx, req.id, { patientId: d.patientId });
      return row;
    });
    await this.syncPatientAbha(patient, link.abhaNumber);
    return abhaLinkDto(link);
  }

  links(query: unknown): Promise<Paginated<integrations.AbhaLink>> {
    const q = integrations.abhaLinkQuerySchema.parse(query);
    return this.db.tx(async (tx) => {
      const { items, total } = await this.repo.abhaLinks(tx, q);
      return { items: items.map(abhaLinkDto), page: q.page, pageSize: q.pageSize, total };
    });
  }

  unlink(id: string, input: integrations.AbhaUnlinkInput): Promise<integrations.AbhaLink> {
    const d = integrations.abhaUnlinkSchema.parse(input);
    return this.db.tx(async (tx) => {
      const link = await this.repo.abhaLink(tx, id, true);
      if (!link) throw notFound('ABHA link');
      if (link.status !== 'linked') throw conflict('already_unlinked', 'This ABHA is already unlinked');
      const row = await this.repo.updateAbhaLink(tx, id, {
        status: 'unlinked',
        unlinkedAt: new Date().toISOString(),
        unlinkReason: d.reason,
        updatedBy: currentContext()?.userId ?? null,
      });
      await this.outbox.publish(tx, 'integrations.abha.unlinked', { patientId: row.patientId, abhaNumber: row.abhaNumber });
      return abhaLinkDto(row);
    });
  }

  /** Inside the caller's transaction: one active ABHA per patient and one patient per ABHA. */
  private async createLink(tx: Tx, patientId: string, profile: AbhaProfile, verifiedVia: integrations.AbhaLink['verifiedVia'], requestId: string | null): Promise<AbhaLinkRow> {
    const existing = await this.repo.activeLinkForPatient(tx, patientId);
    if (existing) {
      if (existing.abhaNumber === profile.abhaNumber) return existing;
      throw conflict('patient_has_abha', `This patient is already linked to ABHA ${mask(existing.abhaNumber)}. Unlink it first.`);
    }
    const other = await this.repo.activeLinkForAbha(tx, profile.abhaNumber);
    if (other) throw conflict('abha_linked_elsewhere', 'This ABHA is already linked to another patient record');
    const userId = currentContext()?.userId ?? null;
    const row = await this.repo.insertAbhaLink(tx, {
      patientId,
      abhaNumber: profile.abhaNumber,
      abhaAddress: profile.abhaAddress,
      name: profile.name,
      gender: profile.gender,
      yearOfBirth: profile.yearOfBirth,
      verifiedVia,
      requestId,
      createdBy: userId,
      updatedBy: userId,
    });
    const event: integrations.AbhaLinkedEvent = { patientId, abhaNumber: row.abhaNumber, abhaAddress: row.abhaAddress };
    await this.outbox.publish(tx, 'integrations.abha.linked', { ...event });
    return row;
  }

  /** The patient master keeps the ABHA number too (front office search, printouts). */
  private async syncPatientAbha(patient: Patient, abhaNumber: string) {
    if (patient.abhaNumber !== abhaNumber) await this.patients.update(patient.id, { abhaNumber });
  }

  // =====================================================================
  // Scan and Share (patient scans the hospital QR in their ABHA app)
  // =====================================================================

  /** Public callback from the ABDM gateway (or simulator). The tenant was bound by the controller. */
  async profileShareCallback(body: unknown, raw: string, signature: string | undefined): Promise<{ tokenNo: number; status: string }> {
    if (!this.config.abdmCallbackSecret || !signature || !safeEqual(signature, hmacSha256(this.config.abdmCallbackSecret, raw))) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'invalid_signature', 'Callback signature is not valid');
    }
    const d = integrations.profileShareCallbackSchema.parse(body);
    const row = await this.db.tx(async (tx) => {
      const s = await this.settings.effective(tx);
      // Hide hospitals that have not switched ABDM on (same answer as an unknown hospital).
      if (s.abdmMode === 'disabled') throw notFound('Facility');
      return this.receiveProfile(tx, d);
    });
    return { tokenNo: row.tokenNo, status: row.status };
  }

  /** Mock mode only: behave as if a patient scanned the hospital QR. */
  async simulateScan(input: integrations.ScanShareSimulate): Promise<integrations.ScanShareToken> {
    const d = integrations.scanShareSimulateSchema.parse(input);
    return this.db.tx(async (tx) => {
      const s = await this.settings.effective(tx);
      if (s.abdmMode !== 'mock') throw conflict('mock_only', 'Simulation is only available in ABDM mock mode');
      const abhaNumber = `91${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`;
      const handle = d.name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 20) || 'patient';
      const row = await this.receiveProfile(tx, {
        requestId: `mock-share-${randomUUID()}`,
        profile: { abhaNumber, abhaAddress: `${handle}.${abhaNumber.slice(-4)}@sbx`, name: d.name, gender: d.gender, yearOfBirth: d.yearOfBirth, mobile: d.mobile ?? null },
      });
      return scanShareDto(row);
    });
  }

  private async receiveProfile(tx: Tx, input: integrations.ProfileShareCallback): Promise<ScanShareRow> {
    const d = integrations.profileShareCallbackSchema.parse(input);
    const existing = await this.repo.scanShareByRequest(tx, d.requestId);
    if (existing) return existing;
    const profile: AbhaProfile = {
      abhaNumber: d.profile.abhaNumber,
      abhaAddress: d.profile.abhaAddress ?? null,
      name: d.profile.name,
      gender: d.profile.gender,
      yearOfBirth: d.profile.yearOfBirth ?? null,
      mobile: d.profile.mobile ?? null,
    };
    const row = await this.repo.insertScanShare(tx, { gatewayRequestId: d.requestId, tokenDate: istToday(), profile });
    await this.outbox.publish(tx, 'integrations.scan_share.received', { tokenId: row.id, tokenNo: row.tokenNo, abhaNumber: profile.abhaNumber });
    return row;
  }

  scanShares(query: unknown): Promise<integrations.ScanShareToken[]> {
    const q = integrations.scanShareQuerySchema.parse(query);
    return this.db.tx(async (tx) => (await this.repo.scanShares(tx, { date: q.date ?? istToday(), status: q.status })).map(scanShareDto));
  }

  async resolveScanShare(id: string, input: integrations.ScanShareResolve): Promise<integrations.ScanShareToken> {
    const d = integrations.scanShareResolveSchema.parse(input);
    const userId = currentContext()?.userId ?? null;
    if (d.action === 'dismiss') {
      return this.db.tx(async (tx) => {
        await this.pendingToken(tx, id);
        return scanShareDto(await this.repo.updateScanShare(tx, id, { status: 'dismissed', resolvedBy: userId, resolvedAt: new Date().toISOString() }));
      });
    }
    if (d.action === 'link') {
      const patient = await this.patients.get(d.patientId);
      const row = await this.db.tx(async (tx) => {
        const token = await this.pendingToken(tx, id);
        await this.createLink(tx, patient.id, token.profile as AbhaProfile, 'scan_share', null);
        return this.repo.updateScanShare(tx, id, { status: 'linked', patientId: patient.id, resolvedBy: userId, resolvedAt: new Date().toISOString() });
      });
      await this.syncPatientAbha(patient, (row.profile as AbhaProfile).abhaNumber);
      return scanShareDto(row);
    }
    // Register: claim the token first so a double click cannot create two patients.
    const claimed = await this.db.tx(async (tx) => {
      const token = await this.pendingToken(tx, id);
      const profile = token.profile as AbhaProfile;
      if (await this.repo.activeLinkForAbha(tx, profile.abhaNumber)) {
        throw conflict('abha_linked_elsewhere', 'This ABHA is already linked to a patient. Use "Link to existing" instead.');
      }
      return this.repo.updateScanShare(tx, id, { status: 'registered', resolvedBy: userId, resolvedAt: new Date().toISOString() });
    });
    const profile = claimed.profile as AbhaProfile;
    try {
      const [firstName, ...rest] = profile.name.trim().split(/\s+/);
      const patient = await this.patients.create({
        firstName: firstName.slice(0, 100),
        lastName: rest.join(' ').slice(0, 100) || undefined,
        gender: profile.gender,
        ageYears: profile.yearOfBirth ? Math.max(0, new Date().getFullYear() - profile.yearOfBirth) : undefined,
        mobile: profile.mobile ?? undefined,
        abhaNumber: profile.abhaNumber,
      });
      return await this.db.tx(async (tx) => {
        await this.createLink(tx, patient.id, profile, 'scan_share', null);
        return scanShareDto(await this.repo.updateScanShare(tx, id, { patientId: patient.id }));
      });
    } catch (e) {
      await this.db.tx((tx) => this.repo.updateScanShare(tx, id, { status: 'pending', resolvedBy: null, resolvedAt: null }));
      throw e;
    }
  }

  private async pendingToken(tx: Tx, id: string): Promise<ScanShareRow> {
    const token = await this.repo.scanShare(tx, id, true);
    if (!token) throw notFound('Scan and Share token');
    if (token.status !== 'pending') throw conflict('token_resolved', 'This token has already been handled');
    return token;
  }

  // =====================================================================
  // HIP care contexts
  // =====================================================================

  /** From an outbox event (worker). Skips patients without ABHA and hospitals with ABDM off. */
  async addCareContext(input: { patientId: string; reference: string; display: string; hiTypes: string[]; sourceModule: string; sourceRefId: string | null }): Promise<CareContextRow | null> {
    if (!input.patientId) return null;
    const created = await this.db.tx(async (tx) => {
      const s = await this.settings.effective(tx);
      if (s.abdmMode === 'disabled') return null;
      const link = await this.repo.activeLinkForPatient(tx, input.patientId);
      if (!link) return null;
      const row = await this.repo.insertCareContext(tx, {
        patientId: input.patientId,
        abhaLinkId: link.id,
        reference: input.reference,
        display: input.display.slice(0, 200),
        hiTypes: input.hiTypes,
        sourceModule: input.sourceModule,
        sourceRefId: isUuid(input.sourceRefId) ? input.sourceRefId : null,
      });
      return row ? { row, link, gateway: this.settings.abdmGateway(s.abdmMode) } : null;
    });
    if (!created) return null;
    return this.pushCareContext(created.row, created.link, created.gateway);
  }

  careContexts(query: unknown): Promise<Paginated<integrations.CareContext>> {
    const q = integrations.careContextQuerySchema.parse(query);
    return this.db.tx(async (tx) => {
      const { items, total } = await this.repo.careContexts(tx, q);
      const links = new Map<string, AbhaLinkRow | undefined>();
      for (const i of items) if (!links.has(i.abhaLinkId)) links.set(i.abhaLinkId, await this.repo.abhaLink(tx, i.abhaLinkId));
      return { items: items.map((i) => careContextDto(i, links.get(i.abhaLinkId)?.abhaNumber ?? '')), page: q.page, pageSize: q.pageSize, total };
    });
  }

  async retryCareContext(id: string): Promise<integrations.CareContext> {
    const { row, link, gateway } = await this.db.tx(async (tx) => {
      const row = await this.repo.careContext(tx, id);
      if (!row) throw notFound('Care context');
      if (row.status === 'linked') throw conflict('already_linked', 'This record is already linked');
      const { gateway } = await this.settings.abdm(tx);
      return { row, link: (await this.repo.abhaLink(tx, row.abhaLinkId))!, gateway };
    });
    return careContextDto(await this.pushCareContext(row, link, gateway), link.abhaNumber);
  }

  private async pushCareContext(row: CareContextRow, link: AbhaLinkRow, gateway: AbdmGateway): Promise<CareContextRow> {
    let error: string | null = null;
    try {
      await gateway.linkCareContext({
        abhaNumber: link.abhaNumber,
        abhaAddress: link.abhaAddress,
        patientRef: row.patientId,
        reference: row.reference,
        display: row.display,
        hiTypes: row.hiTypes,
      });
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 300) : 'Gateway error';
      this.logger.warn(`care context ${row.reference} not linked: ${error}`);
    }
    return this.db.tx((tx) =>
      this.repo.updateCareContext(tx, row.id, {
        status: error ? 'failed' : 'linked',
        error,
        attempts: row.attempts + 1,
        linkedAt: error ? null : new Date().toISOString(),
      }),
    );
  }

  // =====================================================================
  // HIU consent requests
  // =====================================================================

  async requestConsent(input: integrations.ConsentRequestInput): Promise<integrations.ConsentRequest> {
    const d = integrations.consentRequestSchema.parse(input);
    await this.patients.get(d.patientId);
    const ctx = currentContext()!;
    const { link, gateway, hiuId } = await this.db.tx(async (tx) => {
      const { gateway, settings } = await this.settings.abdm(tx);
      const link = await this.repo.activeLinkForPatient(tx, d.patientId);
      if (!link?.abhaAddress) throw conflict('no_abha_address', 'Link the patient\'s ABHA (with an ABHA address) before requesting records');
      return { link, gateway, hiuId: settings.hfrId };
    });
    const expiresAt = new Date(Date.now() + d.validDays * 86_400_000).toISOString();
    const { gatewayRequestId } = await gateway.requestConsent({
      abhaAddress: link.abhaAddress!,
      purpose: d.purpose,
      hiTypes: d.hiTypes,
      dateFrom: d.dateFrom,
      dateTo: d.dateTo,
      expiresAt,
      hiuId,
    });
    return this.db.tx(async (tx) => {
      const row = await this.repo.insertConsent(tx, {
        patientId: d.patientId,
        abhaAddress: link.abhaAddress!,
        purpose: d.purpose,
        hiTypes: d.hiTypes,
        dateFrom: d.dateFrom,
        dateTo: d.dateTo,
        expiresAt,
        gatewayRequestId,
        requestedBy: ctx.userId ?? null,
      });
      await this.outbox.publish(tx, 'integrations.consent.requested', { consentId: row.id, patientId: row.patientId, purpose: row.purpose });
      return consentDto(row);
    });
  }

  consents(query: unknown): Promise<Paginated<integrations.ConsentRequest>> {
    const q = integrations.consentQuerySchema.parse(query);
    return this.db.tx(async (tx) => {
      const { items, total } = await this.repo.consents(tx, q);
      return { items: items.map(consentDto), page: q.page, pageSize: q.pageSize, total };
    });
  }

  getConsent(id: string): Promise<integrations.ConsentRequest> {
    return this.db.tx(async (tx) => consentDto(await this.consentRow(tx, id)));
  }

  async refreshConsent(id: string): Promise<integrations.ConsentRequest> {
    const { row, gateway } = await this.db.tx(async (tx) => ({ row: await this.consentRow(tx, id), gateway: (await this.settings.abdm(tx)).gateway }));
    if (row.status !== 'requested' && row.status !== 'granted') return consentDto(row);
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      return this.db.tx(async (tx) => consentDto(await this.repo.updateConsent(tx, id, { status: 'expired' })));
    }
    if (row.status === 'granted' || !row.gatewayRequestId) return consentDto(row);
    const res = await gateway.consentStatus(row.gatewayRequestId);
    return this.db.tx(async (tx) => {
      const updated = await this.repo.updateConsent(tx, id, { status: res.status, artefactIds: res.artefactIds });
      if (res.status !== row.status) {
        await this.outbox.publish(tx, `integrations.consent.${res.status}`, { consentId: id, patientId: row.patientId });
      }
      return consentDto(updated);
    });
  }

  async consentRecords(id: string): Promise<integrations.FhirBundle[]> {
    const { row, gateway } = await this.db.tx(async (tx) => ({ row: await this.consentRow(tx, id), gateway: (await this.settings.abdm(tx)).gateway }));
    if (row.status !== 'granted') throw conflict('consent_not_granted', 'Records can be fetched only after the patient grants consent');
    if (new Date(row.expiresAt).getTime() < Date.now()) throw conflict('consent_expired', 'This consent has expired; raise a new request');
    return gateway.fetchRecords({ artefactIds: row.artefactIds, hiTypes: row.hiTypes, abhaAddress: row.abhaAddress, dateFrom: row.dateFrom, dateTo: row.dateTo });
  }

  private async consentRow(tx: Tx, id: string): Promise<ConsentRow> {
    const row = await this.repo.consent(tx, id);
    if (!row) throw notFound('Consent request');
    return row;
  }

  // =====================================================================
  // FHIR
  // =====================================================================

  async fhirPatient(id: string): Promise<integrations.FhirResource> {
    const patient = await this.patients.get(id);
    const link = await this.db.tx((tx) => this.repo.activeLinkForPatient(tx, id));
    const tenantId = currentContext()!.tenantId!;
    return toFhirPatient(patient, link ? abhaLinkDto(link) : null, `${this.config.publicApiUrl}/fhir/sid/uhid/${tenantId}`);
  }
}

// ---------- mapping ----------

const isUuid = (v: string | null | undefined): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v);
const displayName = (p: Patient) => [p.firstName, p.lastName].filter(Boolean).join(' ');

export function abhaRequestDto(r: AbhaRequestRow): integrations.AbhaRequest {
  return {
    id: r.id,
    purpose: r.purpose as integrations.AbhaPurpose,
    method: r.method as integrations.AbhaOtpMethod,
    identifierMasked: r.identifierMasked,
    status: r.status as integrations.AbhaRequestStatus,
    sentTo: r.sentTo,
    expiresAt: iso(r.expiresAt),
    patientId: r.patientId,
    profile: (r.profile as AbhaProfile | null) ?? null,
    createdAt: iso(r.createdAt),
  };
}

export function abhaLinkDto(r: AbhaLinkRow): integrations.AbhaLink {
  return {
    id: r.id,
    patientId: r.patientId,
    abhaNumber: r.abhaNumber,
    abhaAddress: r.abhaAddress,
    name: r.name,
    gender: r.gender,
    yearOfBirth: r.yearOfBirth,
    verifiedVia: r.verifiedVia as integrations.AbhaLink['verifiedVia'],
    status: r.status as integrations.AbhaLinkStatus,
    linkedAt: iso(r.linkedAt),
    unlinkedAt: iso(r.unlinkedAt),
    unlinkReason: r.unlinkReason,
  };
}

function scanShareDto(r: ScanShareRow): integrations.ScanShareToken {
  return {
    id: r.id,
    tokenNo: r.tokenNo,
    tokenDate: r.tokenDate,
    profile: r.profile as AbhaProfile,
    status: r.status as integrations.ScanShareStatus,
    patientId: r.patientId,
    createdAt: iso(r.createdAt),
  };
}

function careContextDto(r: CareContextRow, abhaNumber: string): integrations.CareContext {
  return {
    id: r.id,
    patientId: r.patientId,
    abhaNumber,
    reference: r.reference,
    display: r.display,
    hiTypes: r.hiTypes as integrations.HealthInfoType[],
    sourceModule: r.sourceModule,
    sourceRefId: r.sourceRefId,
    status: r.status as integrations.CareContextStatus,
    linkedAt: iso(r.linkedAt),
    error: r.error,
    createdAt: iso(r.createdAt),
  };
}

function consentDto(r: ConsentRow): integrations.ConsentRequest {
  return {
    id: r.id,
    patientId: r.patientId,
    abhaAddress: r.abhaAddress,
    purpose: r.purpose as integrations.ConsentPurpose,
    hiTypes: r.hiTypes as integrations.HealthInfoType[],
    dateFrom: r.dateFrom,
    dateTo: r.dateTo,
    expiresAt: iso(r.expiresAt),
    status: r.status as integrations.ConsentStatus,
    gatewayRequestId: r.gatewayRequestId,
    artefactIds: r.artefactIds,
    requestedBy: r.requestedBy,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

