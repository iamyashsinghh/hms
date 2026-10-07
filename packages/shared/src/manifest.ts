import type { SystemRoleKey } from './roles';

export interface PermissionDef {
  /** module.resource.action, e.g. `billing.invoice.create`. */
  key: string;
  description: string;
}

/**
 * Each product module describes itself with one manifest: its permissions and which
 * system roles get them by default. The seed script turns these into database rows,
 * and the web/mobile apps use the keys to show or hide screens.
 */
export interface ModuleManifest {
  key: string;
  name: string;
  permissions: readonly PermissionDef[];
  grants: Partial<Record<SystemRoleKey, readonly string[]>>;
}

export function defineModule<const M extends ModuleManifest>(m: M): M {
  for (const p of m.permissions) {
    if (!p.key.startsWith(`${m.key}.`) || p.key.split('.').length !== 3) {
      throw new Error(`Permission ${p.key} must look like ${m.key}.<resource>.<action>`);
    }
  }
  const known = new Set(m.permissions.map((p) => p.key));
  for (const [role, keys] of Object.entries(m.grants)) {
    for (const k of keys ?? []) {
      if (!known.has(k)) throw new Error(`Grant ${role} -> ${k} is not a permission of ${m.key}`);
    }
  }
  return m;
}
