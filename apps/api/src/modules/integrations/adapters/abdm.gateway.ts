import { HttpStatus } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { integrations } from '@hms/shared';
import { AppError, badRequest } from '../../../common/errors/errors';
import { sha256 } from '../crypto';

type AbhaProfile = integrations.AbhaProfile;
type FhirBundle = integrations.FhirBundle;

export interface OtpStart {
  purpose: integrations.AbhaPurpose;
  method: integrations.AbhaOtpMethod;
  identifier: string;
}

export interface CareContextLink {
  abhaNumber: string;
  abhaAddress: string | null;
  patientRef: string;
  reference: string;
  display: string;
  hiTypes: string[];
}

export interface ConsentAsk {
  abhaAddress: string;
  purpose: string;
  hiTypes: string[];
  dateFrom: string;
  dateTo: string;
  expiresAt: string;
  hiuId: string | null;
}

/**
 * Everything the hospital does with the ABDM gateway (ABHA create/verify, HIP care-context linking,
 * HIU consent and data fetch). Adapters: MockAbdmGateway (built-in simulator) and SandboxAbdmGateway.
 */
export interface AbdmGateway {
  readonly name: string;
  requestOtp(input: OtpStart): Promise<{ txnId: string; sentTo: string | null; expiresInSeconds: number }>;
  verifyOtp(input: { txnId: string; otp: string; nameHint?: string | null }): Promise<AbhaProfile>;
  linkCareContext(input: CareContextLink): Promise<void>;
  requestConsent(input: ConsentAsk): Promise<{ gatewayRequestId: string }>;
  consentStatus(gatewayRequestId: string): Promise<{ status: integrations.ConsentStatus; artefactIds: string[] }>;
  fetchRecords(input: { artefactIds: string[]; hiTypes: string[]; abhaAddress: string; dateFrom: string; dateTo: string }): Promise<FhirBundle[]>;
}

export const MOCK_OTP = '123456';

/**
 * Deterministic in-process ABDM simulator. OTP is always 123456. The txn id carries what the
 * simulator needs (a hash of the identifier, never the Aadhaar number), so it is stateless.
 */
export class MockAbdmGateway implements AbdmGateway {
  readonly name = 'mock';

  async requestOtp(input: OtpStart) {
    const id = input.identifier.replace(/[\s-]/g, '');
    const hint: Record<string, string> = { p: input.purpose, m: input.method, h: sha256(id).slice(0, 24) };
    if (input.method === 'mobile') hint.mobile = id;
    if (input.method === 'abha') hint.abha = id;
    const txnId = `mock.${Buffer.from(JSON.stringify(hint)).toString('base64url')}.${randomUUID()}`;
    const sentTo = input.method === 'mobile' ? `******${id.slice(-4)}` : `******${digits(hint.h, 4)}`;
    return { txnId, sentTo, expiresInSeconds: 600 };
  }

  async verifyOtp(input: { txnId: string; otp: string; nameHint?: string | null }): Promise<AbhaProfile> {
    const hint = decodeHint(input.txnId);
    if (input.otp !== MOCK_OTP) throw badRequest('invalid_otp', 'The OTP is incorrect');
    const abhaFromInput = hint.abha && /^\d{14}$/.test(hint.abha) ? hint.abha : null;
    const abhaNumber = abhaFromInput ?? `91${digits(hint.h, 12)}`;
    const name = input.nameHint?.trim() || 'ABHA Sandbox User';
    const handle = name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 20) || 'patient';
    const abhaAddress = hint.abha && hint.abha.includes('@') ? hint.abha.toLowerCase() : `${handle}.${abhaNumber.slice(-4)}@sbx`;
    return {
      abhaNumber,
      abhaAddress,
      name,
      gender: 'unknown',
      yearOfBirth: 1980 + (parseInt(hint.h.slice(0, 4), 16) % 30),
      mobile: hint.mobile ?? null,
    };
  }

  async linkCareContext(input: CareContextLink) {
    if (input.display.includes('[fail]')) throw new AppError(HttpStatus.BAD_GATEWAY, 'abdm_error', 'Simulated gateway failure');
  }

  async requestConsent(_input: ConsentAsk) {
    return { gatewayRequestId: `mock-consent-${randomUUID()}` };
  }

  /** The simulator's patient approves every request straight away. */
  async consentStatus(gatewayRequestId: string) {
    return { status: 'granted' as const, artefactIds: [`mock-artefact-${sha256(gatewayRequestId).slice(0, 16)}`] };
  }

  async fetchRecords(input: { artefactIds: string[]; hiTypes: string[]; abhaAddress: string; dateFrom: string; dateTo: string }): Promise<FhirBundle[]> {
    return input.hiTypes.map((hiType, i) => ({
      resourceType: 'Bundle',
      id: `mock-${hiType}-${i}`,
      type: 'document',
      timestamp: `${input.dateTo}T10:00:00+05:30`,
      entry: [
        {
          fullUrl: `Composition/mock-${i}`,
          resource: {
            resourceType: 'Composition',
            status: 'final',
            title: `${hiType} (simulated record from another facility)`,
            date: `${input.dateTo}T10:00:00+05:30`,
            subject: { display: input.abhaAddress },
          },
        },
        {
          fullUrl: `Condition/mock-${i}`,
          resource: { resourceType: 'Condition', code: { text: 'Type 2 diabetes mellitus' }, recordedDate: input.dateFrom },
        },
      ],
    }));
  }
}

/**
 * ABDM sandbox (https://sandbox.abdm.gov.in). Needs a registered client id/secret, gateway session tokens
 * and RSA encryption of Aadhaar/OTP payloads. Not wired up yet: every call fails with a clear message so
 * nothing is sent to ABDM until the integration is completed and certified.
 */
export class SandboxAbdmGateway implements AbdmGateway {
  readonly name = 'sandbox';
  constructor(private readonly credentials: { clientId: string; clientSecret: string } | null) {}

  private fail(): never {
    throw new AppError(
      HttpStatus.SERVICE_UNAVAILABLE,
      'integration_not_configured',
      this.credentials
        ? 'The ABDM sandbox connection is not enabled in this build yet. Use mock mode for now.'
        : 'ABDM sandbox credentials are not set on the server. Use mock mode for now.',
    );
  }
  requestOtp(): Promise<never> { return Promise.resolve(this.fail()); }
  verifyOtp(): Promise<never> { return Promise.resolve(this.fail()); }
  linkCareContext(): Promise<never> { return Promise.resolve(this.fail()); }
  requestConsent(): Promise<never> { return Promise.resolve(this.fail()); }
  consentStatus(): Promise<never> { return Promise.resolve(this.fail()); }
  fetchRecords(): Promise<never> { return Promise.resolve(this.fail()); }
}

function decodeHint(txnId: string): { p: string; m: string; h: string; mobile?: string; abha?: string } {
  const [kind, data] = txnId.split('.');
  try {
    if (kind !== 'mock' || !data) throw new Error();
    const hint = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (typeof hint.h !== 'string') throw new Error();
    return hint;
  } catch {
    throw badRequest('invalid_txn', 'This OTP request is not valid any more; request a new OTP');
  }
}

/** n decimal digits derived from a hex hash. */
function digits(hex: string, n: number): string {
  let out = '';
  for (let i = 0; out.length < n; i = (i + 1) % hex.length) out += (parseInt(hex[i], 16) % 10).toString();
  return out;
}
