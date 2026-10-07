import { SYSTEM_ROLES } from '@hms/shared';

export function roleLabel(role: string): string {
  return (SYSTEM_ROLES as Record<string, string>)[role] ?? role.replace(/_/g, ' ');
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function ageFrom(dateOfBirth: string | null, ageYears?: number): string | null {
  if (dateOfBirth) {
    const dob = new Date(dateOfBirth);
    if (!Number.isNaN(dob.getTime())) {
      const now = new Date();
      let age = now.getFullYear() - dob.getFullYear();
      const m = now.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
      return `${age}y`;
    }
  }
  return ageYears !== undefined ? `${ageYears}y` : null;
}
