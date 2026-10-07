// Module registry. Each module file is owned by one workstream (see PARALLEL_PLAN.md).
// This index is owned by the foundation; module threads do not edit it.
import type { ModuleManifest } from '../manifest';
import { coreModule } from './core';
import { frontofficeModule } from './frontoffice';
import { emrModule } from './emr';
import { billingModule } from './billing';
import { pharmacyModule } from './pharmacy';
import { setupModule } from './setup';
import { platformModule } from './platform';
import { notificationsModule } from './notifications';
import { reportsModule } from './reports';
import { portalModule } from './portal';
import { labModule } from './lab';
import { radiologyModule } from './radiology';
import { ipdModule } from './ipd';
import { inventoryModule } from './inventory';
import { insuranceModule } from './insurance';
import { crmModule } from './crm';
import { hrModule } from './hr';
import { qualityModule } from './quality';
import { opsModule } from './ops';
import { integrationsModule } from './integrations';

export const ALL_MODULES: readonly ModuleManifest[] = [coreModule, frontofficeModule, emrModule, billingModule, pharmacyModule, setupModule, platformModule, notificationsModule, reportsModule, portalModule, labModule, radiologyModule, ipdModule, inventoryModule, insuranceModule, crmModule, hrModule, qualityModule, opsModule, integrationsModule];

export * from './core';
export * as frontoffice from './frontoffice';
export * as emr from './emr';
export * as billing from './billing';
export * as pharmacy from './pharmacy';
export * as setup from './setup';
export * as platform from './platform';
export * as notifications from './notifications';
export * as reports from './reports';
export * as portal from './portal';
export * as lab from './lab';
export * as radiology from './radiology';
export * as ipd from './ipd';
export * as inventory from './inventory';
export * as insurance from './insurance';
export * as crm from './crm';
export * as hr from './hr';
export * as quality from './quality';
export * as ops from './ops';
export * as integrations from './integrations';
