/** Pure helpers: template rendering, SMS part counting, address normalising. */

const VAR_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

export function templateVariables(text: string): string[] {
  return [...new Set([...text.matchAll(VAR_RE)].map((m) => m[1]!))];
}

/** Replaces {{name}} with data[name]; unknown names become '' and are reported. */
export function render(text: string, data: Record<string, unknown>): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const out = text.replace(VAR_RE, (_, name: string) => {
    const v = data[name];
    if (v === undefined || v === null || v === '') {
      missing.add(name);
      return '';
    }
    return String(v);
  });
  return { text: out.replace(/[ \t]{2,}/g, ' '), missing: [...missing] };
}

// GSM 03.38 basic + extension characters. Anything else forces UCS-2 (70 chars per part).
const GSM_RE = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;

/** Number of SMS parts a body needs. */
export function smsParts(body: string): number {
  if (!body.length) return 1;
  if (GSM_RE.test(body)) {
    const len = [...body].reduce((n, ch) => n + ('^{}\\[~]|€'.includes(ch) ? 2 : 1), 0);
    return len <= 160 ? 1 : Math.ceil(len / 153);
  }
  const len = [...body].length;
  return len <= 70 ? 1 : Math.ceil(len / 67);
}

/** 10-digit Indian mobile from +91/0-prefixed or spaced input; null if it is not one. */
export function normalizeMobile(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, '');
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

export function normalizeAddress(channel: string, address: string): string {
  if (channel === 'email') return address.trim().toLowerCase();
  if (channel === 'sms' || channel === 'whatsapp') return normalizeMobile(address) ?? address.trim();
  if (channel === 'all') return address.includes('@') ? address.trim().toLowerCase() : (normalizeMobile(address) ?? address.trim());
  return address.trim();
}

const IST = 'Asia/Kolkata';
export const formatDateIST = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' });
export const formatTimeIST = (d: Date) => d.toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase();
export const formatAmount = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Start of today in IST, as a Date. */
export function startOfTodayIST(now = new Date()): Date {
  const ist = new Date(now.getTime() + 330 * 60_000);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - 330 * 60_000);
}
