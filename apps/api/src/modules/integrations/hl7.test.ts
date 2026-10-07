import { describe, expect, it } from 'vitest';
import { buildAck, hl7Time, Hl7Error, parseOru, peekHeader } from './hl7';
import { formatApiKey, mask, parseApiKey, signWebhook } from './crypto';
import { formatAbha } from './fhir';

const ORU = [
  'MSH|^~\\&|SYSMEX|LAB|HMS|HOSP|20261007101500||ORU^R01|MSG0001|P|2.5.1',
  'PID|1||UH000123||Sharma^Ravi',
  'OBR|1|S1001|S1001|CBC^Complete Blood Count',
  'OBX|1|NM|HGB^Hemoglobin||13.5|g/dL|13.0-17.0|N|||F|||20261007101000',
  'OBX|2|NM|WBC^WBC Count||12.4|10*3/uL|4.0-11.0|H|||F|||20261007101000',
].join('\r');

describe('HL7 v2', () => {
  it('parses an ORU^R01 result message', () => {
    const m = parseOru(ORU);
    expect(m).toMatchObject({ messageType: 'ORU^R01', controlId: 'MSG0001', sendingApp: 'SYSMEX', sampleId: 'S1001', patientRef: 'UH000123' });
    expect(m.results).toHaveLength(2);
    expect(m.results[1]).toEqual({ code: 'WBC', name: 'WBC Count', value: '12.4', unit: '10*3/uL', referenceRange: '4.0-11.0', flag: 'H', observedAt: '2026-10-07T04:40:00.000Z' });
  });

  it('accepts newline separated segments', () => {
    expect(parseOru(ORU.replace(/\r/g, '\n')).results).toHaveLength(2);
  });

  it('rejects other message types and messages without results', () => {
    expect(() => parseOru(ORU.replace('ORU^R01', 'ADT^A01'))).toThrow(Hl7Error);
    expect(() => parseOru(ORU.split('\r').slice(0, 3).join('\r'))).toThrow('No OBX');
    expect(() => parseOru('hello world')).toThrow('MSH');
  });

  it('builds AA and AE acknowledgements echoing the control id', () => {
    const h = peekHeader(ORU);
    expect(buildAck({ ...h, ok: true })).toMatch(/\rMSA\|AA\|MSG0001\|$/);
    const ae = buildAck({ ...h, ok: false, error: 'bad | thing' });
    expect(ae).toContain('MSA|AE|MSG0001|bad   thing');
    expect(ae.split('\r')[0]).toContain('|SYSMEX|LAB|');
  });

  it('reads HL7 timestamps as IST', () => {
    expect(hl7Time('20261007')).toBe('2026-10-06T18:30:00.000Z');
    expect(hl7Time('garbage')).toBeNull();
  });
});

describe('integration helpers', () => {
  it('round-trips API keys and rejects malformed ones', () => {
    const t = '01a1153b-6613-7e43-af9d-3cfd32185f2a';
    const k = '01a1153b-6613-7e43-af9d-3cfd32185f2b';
    expect(parseApiKey(formatApiKey(t, k, 'x'.repeat(30)))).toEqual({ tenantId: t, keyId: k, secret: 'x'.repeat(30) });
    expect(parseApiKey('hmsk.nope.nope.secret')).toBeNull();
    expect(parseApiKey('')).toBeNull();
  });

  it('masks identifiers and formats ABHA numbers', () => {
    expect(mask('1234 5678 9012')).toBe('********9012');
    expect(formatAbha('91123456789012')).toBe('91-1234-5678-9012');
  });

  it('signs webhooks with a timestamp', () => {
    expect(signWebhook('s', '{}', 100)).toMatch(/^t=100,v1=[0-9a-f]{64}$/);
  });
});
