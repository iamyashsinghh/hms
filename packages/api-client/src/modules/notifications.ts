import type { notifications as n, Paginated, PaginationQuery } from '@hms/shared';
import type { Http } from '../http';

/** Notifications endpoints. Owned by the "notifications" workstream. Types come from @hms/shared (notifications.*). */
export const notificationsApi = (http: Http) => ({
  // Delivery log and sending
  messages: (q: n.MessageQuery = {}) => http.get<Paginated<n.Message>>('/notifications/messages', q),
  message: (id: string) => http.get<n.Message>(`/notifications/messages/${id}`),
  stats: () => http.get<n.MessageStats>('/notifications/messages/stats'),
  send: (body: n.SendRequest) => http.post<n.SendResult>('/notifications/messages', body),
  retry: (id: string) => http.post<n.Message>(`/notifications/messages/${id}/retry`),

  // Templates and rules
  templates: () => http.get<n.Template[]>('/notifications/templates'),
  saveTemplate: (key: string, channel: n.Channel, body: n.UpsertTemplate) => http.put<n.Template>(`/notifications/templates/${key}/${channel}`, body),
  resetTemplate: (key: string, channel: n.Channel) => http.delete<void>(`/notifications/templates/${key}/${channel}`),
  previewTemplate: (body: n.PreviewTemplate) => http.post<n.TemplatePreview>('/notifications/templates/preview', body),
  rules: () => http.get<n.Rule[]>('/notifications/rules'),
  updateRule: (body: n.UpdateRule) => http.put<n.Rule>('/notifications/rules', body),

  // Opt-outs
  optOuts: (q: n.OptOutQuery = {}) => http.get<Paginated<n.OptOut>>('/notifications/opt-outs', q),
  addOptOut: (body: n.CreateOptOut) => http.post<n.OptOut>('/notifications/opt-outs', body),
  removeOptOut: (id: string) => http.delete<void>(`/notifications/opt-outs/${id}`),

  // Credits
  credits: () => http.get<n.CreditSummary>('/notifications/credits'),
  ledger: (q: PaginationQuery = {}) => http.get<Paginated<n.LedgerEntry>>('/notifications/credits/ledger', q),
  topup: (body: n.Topup) => http.post<n.CreditSummary>('/notifications/credits/topup', body),

  // Settings
  settings: () => http.get<n.Settings>('/notifications/settings'),
  updateSettings: (body: n.UpdateSettings) => http.put<n.Settings>('/notifications/settings', body),

  // Push devices (mobile apps call these after login)
  devices: () => http.get<n.Device[]>('/notifications/devices'),
  registerDevice: (body: n.RegisterDevice) => http.post<n.Device>('/notifications/devices', body),
  unregisterDevice: (token: string) => http.post<void>('/notifications/devices/unregister', { token }),
});
