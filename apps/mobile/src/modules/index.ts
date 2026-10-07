// Mobile module registry. Owned by the foundation; module workstreams edit only
// src/modules/<key>/index.ts and app/(app)/<key>/.
import { hasPermission } from '@hms/shared';
import type { MobileModuleScreen, ModuleKey, Variant } from './types';
import { screens as frontoffice } from './frontoffice';
import { screens as emr } from './emr';
import { screens as billing } from './billing';
import { screens as pharmacy } from './pharmacy';
import { screens as setup } from './setup';
import { screens as platform } from './platform';
import { screens as notifications } from './notifications';
import { screens as reports } from './reports';
import { screens as portal } from './portal';
import { screens as lab } from './lab';
import { screens as radiology } from './radiology';
import { screens as ipd } from './ipd';
import { screens as inventory } from './inventory';
import { screens as insurance } from './insurance';
import { screens as crm } from './crm';
import { screens as hr } from './hr';
import { screens as quality } from './quality';
import { screens as ops } from './ops';
import { screens as integrations } from './integrations';

export * from './types';

export const MODULE_SCREENS: Record<ModuleKey, readonly MobileModuleScreen[]> = {
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

export interface AvailableScreen extends MobileModuleScreen {
  module: ModuleKey;
}

/** Screens the current app variant includes and the signed-in user is allowed to open. */
export function availableScreens(variant: Variant, permissions: readonly string[]): AvailableScreen[] {
  return (Object.entries(MODULE_SCREENS) as [ModuleKey, readonly MobileModuleScreen[]][]).flatMap(([module, list]) =>
    list
      .filter((s) => s.variants.includes(variant) && (!s.permission || hasPermission(permissions, s.permission)))
      .map((s) => ({ ...s, module })),
  );
}
