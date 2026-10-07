// Typed API client for web and mobile. Owned by the foundation; module threads edit only src/modules/<module>.ts.
import { createHttp, type HttpOptions } from './http';
import { authApi, patientsApi } from './core';
import { frontofficeApi } from './modules/frontoffice';
import { emrApi } from './modules/emr';
import { billingApi } from './modules/billing';
import { pharmacyApi } from './modules/pharmacy';
import { setupApi } from './modules/setup';
import { platformApi } from './modules/platform';
import { notificationsApi } from './modules/notifications';
import { reportsApi } from './modules/reports';
import { portalApi } from './modules/portal';
import { labApi } from './modules/lab';
import { radiologyApi } from './modules/radiology';
import { ipdApi } from './modules/ipd';
import { inventoryApi } from './modules/inventory';
import { insuranceApi } from './modules/insurance';
import { crmApi } from './modules/crm';
import { hrApi } from './modules/hr';
import { qualityApi } from './modules/quality';
import { opsApi } from './modules/ops';
import { integrationsApi } from './modules/integrations';

export function createApiClient(opts: HttpOptions) {
  const http = createHttp(opts);
  return {
    http,
    auth: authApi(http),
    patients: patientsApi(http),
    frontoffice: frontofficeApi(http),
    emr: emrApi(http),
    billing: billingApi(http),
    pharmacy: pharmacyApi(http),
    setup: setupApi(http),
    platform: platformApi(http),
    notifications: notificationsApi(http),
    reports: reportsApi(http),
    portal: portalApi(http),
    lab: labApi(http),
    radiology: radiologyApi(http),
    ipd: ipdApi(http),
    inventory: inventoryApi(http),
    insurance: insuranceApi(http),
    crm: crmApi(http),
    hr: hrApi(http),
    quality: qualityApi(http),
    ops: opsApi(http),
    integrations: integrationsApi(http),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
export { ApiError, createHttp, type Http, type HttpOptions, type Query } from './http';
