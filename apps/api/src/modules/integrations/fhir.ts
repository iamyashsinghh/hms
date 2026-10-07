import type { Patient, integrations } from '@hms/shared';

type AbhaLink = integrations.AbhaLink;
type FhirResource = integrations.FhirResource;

/** ABDM identifier systems. */
export const ABHA_NUMBER_SYSTEM = 'https://healthid.abdm.gov.in';
export const ABHA_ADDRESS_SYSTEM = 'https://healthid.abdm.gov.in/address';

/** FHIR R4 Patient (ABDM profile shape) from the patient master and its active ABHA link. */
export function toFhirPatient(p: Patient, link: AbhaLink | null, uhidSystem: string): FhirResource {
  const identifier: Record<string, unknown>[] = [
    { type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'MR', display: 'Medical record number' }] }, system: uhidSystem, value: p.uhid },
  ];
  const abha = link?.abhaNumber ?? p.abhaNumber;
  if (abha) {
    identifier.push({ type: { coding: [{ system: 'https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-identifier-type-code', code: 'ABHA', display: 'ABHA number' }] }, system: ABHA_NUMBER_SYSTEM, value: formatAbha(abha) });
  }
  if (link?.abhaAddress) identifier.push({ system: ABHA_ADDRESS_SYSTEM, value: link.abhaAddress });
  const telecom: Record<string, string>[] = [];
  if (p.mobile) telecom.push({ system: 'phone', value: p.mobile, use: 'mobile' });
  if (p.email) telecom.push({ system: 'email', value: p.email });
  const resource: FhirResource = {
    resourceType: 'Patient',
    id: p.id,
    meta: { profile: ['https://nrces.in/ndhm/fhir/r4/StructureDefinition/Patient'], lastUpdated: p.updatedAt },
    identifier,
    name: [{ text: [p.firstName, p.lastName].filter(Boolean).join(' '), given: [p.firstName], ...(p.lastName ? { family: p.lastName } : {}) }],
    gender: p.gender,
  };
  if (p.dateOfBirth) resource.birthDate = p.dateOfBirth;
  if (telecom.length) resource.telecom = telecom;
  if (p.address && Object.values(p.address).some(Boolean)) {
    resource.address = [{ line: p.address.line1 ? [p.address.line1] : undefined, city: p.address.city, state: p.address.state, postalCode: p.address.pincode, country: 'IN' }];
  }
  return resource;
}

/** 12345678901234 -> 12-3456-7890-1234 (how ABHA numbers are printed). */
export function formatAbha(n: string): string {
  const d = n.replace(/\D/g, '');
  return d.length === 14 ? `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}-${d.slice(10)}` : n;
}
