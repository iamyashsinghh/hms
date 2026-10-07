// Sidebar registry: one section per module. Owned by the foundation; module workstreams edit only their own nav.ts.
import { ALL_MODULES } from '@hms/shared';
import type { NavItem, NavSection } from './types';
import { nav as core } from './core/nav';
import { nav as frontoffice } from './frontoffice/nav';
import { nav as emr } from './emr/nav';
import { nav as billing } from './billing/nav';
import { nav as pharmacy } from './pharmacy/nav';
import { nav as setup } from './setup/nav';
import { nav as platform } from './platform/nav';
import { nav as notifications } from './notifications/nav';
import { nav as reports } from './reports/nav';
import { nav as portal } from './portal/nav';
import { nav as lab } from './lab/nav';
import { nav as radiology } from './radiology/nav';
import { nav as ipd } from './ipd/nav';
import { nav as inventory } from './inventory/nav';
import { nav as insurance } from './insurance/nav';
import { nav as crm } from './crm/nav';
import { nav as hr } from './hr/nav';
import { nav as quality } from './quality/nav';
import { nav as ops } from './ops/nav';
import { nav as integrations } from './integrations/nav';

const navByModule: Record<string, NavItem[]> = {
  core,
  frontoffice,
  emr,
  billing,
  pharmacy,
  setup,
  platform,
  notifications,
  reports,
  portal,
  lab,
  radiology,
  ipd,
  inventory,
  insurance,
  crm,
  hr,
  quality,
  ops,
  integrations,
};

export const moduleName = (key: string) => ALL_MODULES.find((m) => m.key === key)?.name ?? key;

export const navSections: NavSection[] = Object.entries(navByModule).map(([key, items]) => ({
  key,
  title: key === 'core' ? 'General' : moduleName(key),
  items,
}));

/** Sections with only the items the user may see; empty sections are dropped. */
export function visibleNav(permissions: readonly string[]): NavSection[] {
  return navSections
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.permission || permissions.includes(i.permission)) }))
    .filter((s) => s.items.length > 0);
}

export type { NavItem, NavSection } from './types';
