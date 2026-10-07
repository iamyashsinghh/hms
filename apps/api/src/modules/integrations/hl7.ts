import type { integrations } from '@hms/shared';

type DeviceResult = integrations.DeviceResult;

export interface ParsedHl7 {
  messageType: string | null;
  controlId: string | null;
  sendingApp: string | null;
  sendingFacility: string | null;
  version: string | null;
  sampleId: string | null;
  patientRef: string | null;
  results: DeviceResult[];
}

export class Hl7Error extends Error {}

/** Splits an HL7 v2 message into segments (handles \r, \n and \r\n). */
function segments(raw: string): string[][] {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length || !lines[0].startsWith('MSH')) throw new Hl7Error('Message must start with an MSH segment');
  const fieldSep = lines[0][3];
  if (!fieldSep) throw new Hl7Error('MSH segment has no field separator');
  return lines.map((l) => {
    const f = l.split(fieldSep);
    // MSH-1 is the separator itself, so MSH fields are shifted by one compared to other segments.
    return f[0] === 'MSH' ? ['MSH', fieldSep, ...f.slice(1)] : f;
  });
}

const comp = (field: string | undefined, i = 0): string | null => {
  const v = field?.split('^')[i]?.trim();
  return v ? v : null;
};

/** HL7 TS (YYYYMMDD[HHMM[SS]]) to ISO, treating it as IST when there is no offset. */
export function hl7Time(v: string | null | undefined): string | null {
  const m = v?.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?/);
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+05:30`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Parses an ORU^R01 result message: MSH (type, control id), PID-3 (patient id), OBR-3/OBR-2 (sample /
 * accession id) and one result per OBX (code^name, value, unit, reference range, abnormal flag, time).
 */
export function parseOru(raw: string): ParsedHl7 {
  const segs = segments(raw);
  const msh = segs[0];
  const messageType = msh[9] ? msh[9].split('^').slice(0, 2).join('^') : null;
  const out: ParsedHl7 = {
    messageType,
    controlId: msh[10]?.trim() || null,
    sendingApp: comp(msh[3]),
    sendingFacility: comp(msh[4]),
    version: msh[12]?.trim() || null,
    sampleId: null,
    patientRef: null,
    results: [],
  };
  if (!messageType?.startsWith('ORU')) throw new Hl7Error(`Only ORU^R01 result messages are supported (got ${messageType ?? 'none'})`);
  if (!out.controlId) throw new Hl7Error('MSH-10 (message control id) is required');
  for (const s of segs.slice(1)) {
    if (s[0] === 'PID') out.patientRef = comp(s[3]) ?? comp(s[2]);
    else if (s[0] === 'OBR' && !out.sampleId) out.sampleId = comp(s[3]) ?? comp(s[2]);
    else if (s[0] === 'OBX') {
      const code = comp(s[3], 0);
      const value = s[5]?.trim();
      if (!code || !value) continue;
      out.results.push({
        code,
        name: comp(s[3], 1),
        value: value.replace(/\^/g, ' ').trim(),
        unit: comp(s[6]),
        referenceRange: s[7]?.trim() || null,
        flag: s[8]?.trim() || null,
        observedAt: hl7Time(s[14]?.trim()),
      });
    }
  }
  if (!out.results.length) throw new Hl7Error('No OBX results found');
  return out;
}

/** Best-effort read of MSH-10 and the sender, so even a rejected message gets a proper ACK. */
export function peekHeader(raw: string): { controlId: string | null; sendingApp: string | null; sendingFacility: string | null } {
  try {
    const msh = segments(raw)[0];
    return { controlId: msh[10]?.trim() || null, sendingApp: comp(msh[3]), sendingFacility: comp(msh[4]) };
  } catch {
    return { controlId: null, sendingApp: null, sendingFacility: null };
  }
}

const hl7Now = () => {
  const ist = new Date(Date.now() + 330 * 60_000).toISOString();
  return ist.slice(0, 19).replace(/[-:T]/g, '');
};
const clean = (s: string | null | undefined, max = 80) => (s ?? '').replace(/[|^~\\&\r\n]/g, ' ').slice(0, max);

/** Builds an ACK: MSA-1 AA (accepted) or AE (error) echoing the original control id. */
export function buildAck(opts: { controlId: string | null; sendingApp: string | null; sendingFacility: string | null; ok: boolean; error?: string | null }): string {
  const msh = ['MSH', '^~\\&', 'HMS', 'HMS', clean(opts.sendingApp), clean(opts.sendingFacility), hl7Now(), '', 'ACK^R01^ACK', `ACK${Date.now()}`, 'P', '2.5.1'].join('|');
  const msa = ['MSA', opts.ok ? 'AA' : 'AE', clean(opts.controlId, 50), opts.ok ? '' : clean(opts.error, 200)].join('|');
  const out = [msh, msa];
  if (!opts.ok) out.push(['ERR', '', '', '', 'E', '', '', '', clean(opts.error, 200)].join('|'));
  return out.join('\r');
}
