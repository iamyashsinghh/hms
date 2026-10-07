import type { Paginated, integrations as I } from '@hms/shared';
import type { Http } from '../http';

/** Integrations (ABDM) endpoints. Owned by the "integrations" workstream. Types come from @hms/shared (integrations.*). */
export const integrationsApi = (http: Http) => ({
  settings: {
    get: () => http.get<I.IntegrationSettings>('/integrations/settings'),
    update: (body: I.SettingsInput) => http.put<I.IntegrationSettings>('/integrations/settings', body),
  },
  abha: {
    requestOtp: (body: I.AbhaOtpRequest) => http.post<I.AbhaRequest>('/integrations/abha/otp', body),
    verifyOtp: (body: I.AbhaOtpVerify) => http.post<I.AbhaRequest>('/integrations/abha/otp/verify', body),
    links: (q: I.AbhaLinkQuery = {}) => http.get<Paginated<I.AbhaLink>>('/integrations/abha/links', q),
    link: (body: I.AbhaLinkInput) => http.post<I.AbhaLink>('/integrations/abha/links', body),
    unlink: (id: string, body: I.AbhaUnlinkInput) => http.post<I.AbhaLink>(`/integrations/abha/links/${id}/unlink`, body),
  },
  scanShare: {
    list: (q: I.ScanShareQuery = {}) => http.get<I.ScanShareToken[]>('/integrations/abdm/scan-share', q),
    resolve: (id: string, body: I.ScanShareResolve) => http.post<I.ScanShareToken>(`/integrations/abdm/scan-share/${id}/resolve`, body),
    /** Mock mode only: pretend a patient scanned the hospital QR. */
    simulate: (body: I.ScanShareSimulate = {}) => http.post<I.ScanShareToken>('/integrations/abdm/scan-share/simulate', body),
  },
  careContexts: {
    list: (q: I.CareContextQuery = {}) => http.get<Paginated<I.CareContext>>('/integrations/abdm/care-contexts', q),
    retry: (id: string) => http.post<I.CareContext>(`/integrations/abdm/care-contexts/${id}/retry`),
  },
  consents: {
    list: (q: I.ConsentQuery = {}) => http.get<Paginated<I.ConsentRequest>>('/integrations/abdm/consents', q),
    get: (id: string) => http.get<I.ConsentRequest>(`/integrations/abdm/consents/${id}`),
    create: (body: I.ConsentRequestInput) => http.post<I.ConsentRequest>('/integrations/abdm/consents', body),
    refresh: (id: string) => http.post<I.ConsentRequest>(`/integrations/abdm/consents/${id}/refresh`),
    records: (id: string) => http.get<I.FhirBundle[]>(`/integrations/abdm/consents/${id}/records`),
  },
  fhir: {
    patient: (id: string) => http.get<I.FhirResource>(`/integrations/fhir/Patient/${id}`),
  },
  payments: {
    list: (q: I.PaymentIntentQuery = {}) => http.get<Paginated<I.PaymentIntent>>('/integrations/payments', q),
    get: (id: string) => http.get<I.PaymentIntent>(`/integrations/payments/${id}`),
    create: (body: I.CreatePaymentIntent) => http.post<I.PaymentIntent>('/integrations/payments', body),
    cancel: (id: string) => http.post<I.PaymentIntent>(`/integrations/payments/${id}/cancel`),
    /** Mock provider only: simulate the customer paying (or failing) on the gateway page. */
    mockComplete: (id: string, body: I.MockPaymentOutcome) => http.post<I.PaymentIntent>(`/integrations/payments/${id}/mock-complete`, body),
  },
  apiKeys: {
    list: () => http.get<I.ApiKey[]>('/integrations/api-keys'),
    create: (body: I.CreateApiKey) => http.post<I.CreatedApiKey>('/integrations/api-keys', body),
    revoke: (id: string) => http.post<I.ApiKey>(`/integrations/api-keys/${id}/revoke`),
  },
  webhooks: {
    list: () => http.get<I.WebhookEndpoint[]>('/integrations/webhooks'),
    create: (body: I.WebhookEndpointInput) => http.post<I.WebhookEndpoint>('/integrations/webhooks', body),
    update: (id: string, body: I.WebhookEndpointInput) => http.put<I.WebhookEndpoint>(`/integrations/webhooks/${id}`, body),
    rotateSecret: (id: string) => http.post<I.WebhookEndpoint>(`/integrations/webhooks/${id}/rotate-secret`),
    test: (id: string) => http.post<I.WebhookDelivery>(`/integrations/webhooks/${id}/test`),
    deliveries: (q: I.WebhookDeliveryQuery = {}) => http.get<Paginated<I.WebhookDelivery>>('/integrations/webhooks/deliveries', q),
    retry: (deliveryId: string) => http.post<I.WebhookDelivery>(`/integrations/webhooks/deliveries/${deliveryId}/retry`),
  },
  devices: {
    list: () => http.get<I.LabDevice[]>('/integrations/devices'),
    create: (body: I.DeviceInput) => http.post<I.LabDevice>('/integrations/devices', body),
    update: (id: string, body: I.UpdateDevice) => http.patch<I.LabDevice>(`/integrations/devices/${id}`, body),
    messages: (q: I.DeviceMessageQuery = {}) => http.get<Paginated<I.DeviceMessage>>('/integrations/devices/messages', q),
    message: (id: string) => http.get<I.DeviceMessage>(`/integrations/devices/messages/${id}`),
    /** Feed a sample HL7 message through the same path a machine uses. */
    testMessage: (id: string, body: I.DeviceTestMessage) => http.post<I.Hl7AckResponse>(`/integrations/devices/${id}/test-message`, body),
  },
});
