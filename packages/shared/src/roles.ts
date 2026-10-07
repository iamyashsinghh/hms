/**
 * System roles seeded into every new hospital. Hospitals can also create custom roles
 * from the same permission catalog. Role keys are stable identifiers; names are display text.
 */
export const SYSTEM_ROLES = {
  hospital_admin: 'Hospital Admin',
  owner: 'Owner / Management',
  doctor: 'Doctor',
  nurse: 'Nurse',
  receptionist: 'Receptionist',
  pharmacist: 'Pharmacist',
  lab_technician: 'Lab Technician',
  radiologist: 'Radiologist',
  billing_clerk: 'Billing Clerk',
  accountant: 'Accountant',
  store_keeper: 'Store Keeper',
  hr_manager: 'HR Manager',
  quality_manager: 'Quality Manager',
} as const;

export type SystemRoleKey = keyof typeof SYSTEM_ROLES;
export const SYSTEM_ROLE_KEYS = Object.keys(SYSTEM_ROLES) as SystemRoleKey[];
