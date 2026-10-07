import { ALL_MODULES } from './modules';
import type { SystemRoleKey } from './roles';

/** Every permission key across all modules. */
export const ALL_PERMISSIONS = ALL_MODULES.flatMap((m) => m.permissions);

/** Default permission keys for a system role, merged across modules. */
export function defaultPermissionsForRole(role: SystemRoleKey): string[] {
  return ALL_MODULES.flatMap((m) => [...(m.grants[role] ?? [])]);
}

export function hasPermission(granted: readonly string[], required: string): boolean {
  return granted.includes(required);
}
