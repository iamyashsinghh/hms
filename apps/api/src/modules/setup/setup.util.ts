import { randomInt } from 'node:crypto';
import { currentContext } from '../../common/context/request-context';

/** numeric(14,2) comes back from Postgres as a string. */
export const num = (v: string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));
export const money = (v: number | null | undefined): string | null => (v === null || v === undefined ? null : v.toFixed(2));

/** Postgres `time` is HH:MM:SS; the API speaks HH:MM. */
export const hhmm = (v: string) => v.slice(0, 5);

/** Optional text input: '' and undefined mean "leave unset". */
export const opt = <T>(v: T | undefined | '') => (v === '' || v === undefined ? null : v);

export function ctx() {
  const c = currentContext();
  if (!c?.tenantId) throw new Error('Setup service called without a tenant context');
  return c as typeof c & { tenantId: string };
}

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';

/** Readable temporary password with letters and digits (no 0/O/1/l). */
export function temporaryPassword(): string {
  const pick = (s: string) => s[randomInt(s.length)];
  let out = '';
  for (let i = 0; i < 6; i++) out += pick(LETTERS);
  for (let i = 0; i < 4; i++) out += pick(DIGITS);
  return out;
}

/** "Senior Consultant" -> "senior_consultant". */
export function slugKey(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return /^[a-z]/.test(s) ? s : `role_${s}`;
}
