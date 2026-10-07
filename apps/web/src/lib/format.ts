import type { Patient } from '@hms/shared';
import { SYSTEM_ROLES } from '@hms/shared';

export const roleLabel = (role: string) => SYSTEM_ROLES[role as keyof typeof SYSTEM_ROLES] ?? role;

export const fullName = (p: Pick<Patient, 'firstName' | 'lastName'>) => [p.firstName, p.lastName].filter(Boolean).join(' ');

export function ageOf(p: Pick<Patient, 'dateOfBirth' | 'ageYears'>): string {
  if (p.dateOfBirth) {
    const dob = new Date(p.dateOfBirth);
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    if (now < new Date(now.getFullYear(), dob.getMonth(), dob.getDate())) age--;
    return `${age}y`;
  }
  return p.ageYears != null ? `${p.ageYears}y` : '—';
}

export const genderLabel = (g: string) => g.charAt(0).toUpperCase() + g.slice(1);

export const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
