import type { Paginated, platform as P } from '@hms/shared';
import type { Http } from '../http';

/**
 * SaaS Platform endpoints. Owned by the "platform" workstream. Types come from @hms/shared (platform.*).
 * `api.platform.*` is the hospital side (staff token) plus public signup.
 * The super-admin console uses its own Http with a platform-admin token: `api.platform.console(adminHttp)`.
 */
export const platformApi = (http: Http) => ({
  // public
  plans: () => http.request<P.Plan[]>('GET', '/platform/plans', { auth: false }),
  codeAvailability: (code: string) =>
    http.request<P.CodeAvailability>('GET', '/platform/signup/code-availability', { query: { code }, auth: false }),
  signup: (body: P.Signup) => http.request<P.SignupResult>('POST', '/platform/signup', { body, auth: false }),

  // hospital
  entitlements: () => http.get<P.Entitlements>('/platform/entitlements'),
  subscription: () => http.get<P.SubscriptionOverview>('/platform/subscription'),
  changePlan: (body: P.ChangePlan) => http.post<P.SubscriptionOverview>('/platform/subscription/change', body),
  checkout: () => http.post<P.SubscriptionInvoice>('/platform/subscription/checkout'),
  payInvoice: (id: string, body: P.PayInvoice = {}) => http.post<P.SubscriptionOverview>(`/platform/subscription/invoices/${id}/pay`, body),
  cancel: (body: P.CancelSubscription) => http.post<P.SubscriptionOverview>('/platform/subscription/cancel', body),

  announcements: () => http.get<P.Announcement[]>('/platform/announcements'),
  dismissAnnouncement: (id: string) => http.post<void>(`/platform/announcements/${id}/dismiss`),
  help: (q: P.HelpQuery = {}) => http.get<P.HelpArticle[]>('/platform/help', q),
  helpArticle: (slug: string) => http.get<P.HelpArticle>(`/platform/help/${encodeURIComponent(slug)}`),

  onboarding: () => http.get<P.OnboardingChecklist>('/platform/onboarding'),
  completeStep: (key: P.OnboardingStepKey) => http.post<P.OnboardingChecklist>(`/platform/onboarding/${key}`),
  uncompleteStep: (key: P.OnboardingStepKey) => http.delete<P.OnboardingChecklist>(`/platform/onboarding/${key}`),

  tickets: (q: P.TicketListQuery = {}) => http.get<Paginated<P.Ticket>>('/platform/tickets', q),
  ticket: (id: string) => http.get<P.TicketDetail>(`/platform/tickets/${id}`),
  createTicket: (body: P.CreateTicket) => http.post<P.TicketDetail>('/platform/tickets', body),
  replyTicket: (id: string, body: string) => http.post<P.TicketDetail>(`/platform/tickets/${id}/messages`, { body }),
  resolveTicket: (id: string) => http.post<P.TicketDetail>(`/platform/tickets/${id}/resolve`),

  /** Super-admin console endpoints on an Http that carries the platform-admin token. */
  console: (adminHttp: Http) => platformConsoleApi(adminHttp),
});

export const platformConsoleApi = (http: Http) => {
  const base = '/platform/admin';
  return {
    login: (body: P.PlatformLogin) => http.request<P.PlatformLoginResponse>('POST', `${base}/auth/login`, { body, auth: false }),
    logout: () => http.post<void>(`${base}/auth/logout`),
    me: () => http.get<P.PlatformAdmin>(`${base}/auth/me`),

    dashboard: () => http.get<P.PlatformDashboard>(`${base}/dashboard`),
    tenants: (q: P.TenantListQuery = {}) => http.get<Paginated<P.TenantSummary>>(`${base}/tenants`, q),
    tenant: (id: string) => http.get<P.TenantDetail>(`${base}/tenants/${id}`),
    createTenant: (body: P.AdminCreateTenant) => http.post<P.SignupResult>(`${base}/tenants`, body),
    updateTenant: (id: string, body: P.AdminUpdateTenant) => http.patch<P.TenantDetail>(`${base}/tenants/${id}`, body),
    setTenantStatus: (id: string, body: P.AdminSetTenantStatus) => http.post<P.TenantDetail>(`${base}/tenants/${id}/status`, body),
    setSubscription: (id: string, body: P.AdminSetSubscription) => http.put<P.TenantDetail>(`${base}/tenants/${id}/subscription`, body),
    setEntitlements: (id: string, body: P.AdminSetEntitlements) => http.put<P.TenantDetail>(`${base}/tenants/${id}/entitlements`, body),

    plans: () => http.get<P.Plan[]>(`${base}/plans`),
    createPlan: (body: P.UpsertPlan) => http.post<P.Plan>(`${base}/plans`, body),
    updatePlan: (code: string, body: P.UpdatePlan) => http.patch<P.Plan>(`${base}/plans/${code}`, body),

    invoices: (q: P.InvoiceListQuery = {}) => http.get<Paginated<P.SubscriptionInvoice & { tenantName: string }>>(`${base}/invoices`, q),
    markInvoicePaid: (id: string, body: P.MarkInvoicePaid) => http.post<P.SubscriptionInvoice>(`${base}/invoices/${id}/mark-paid`, body),
    voidInvoice: (id: string) => http.post<P.SubscriptionInvoice>(`${base}/invoices/${id}/void`),

    tickets: (q: P.TicketListQuery = {}) => http.get<Paginated<P.Ticket>>(`${base}/tickets`, q),
    ticket: (id: string) => http.get<P.TicketDetail>(`${base}/tickets/${id}`),
    replyTicket: (id: string, body: P.TicketReply) => http.post<P.TicketDetail>(`${base}/tickets/${id}/messages`, body),
    updateTicket: (id: string, body: P.UpdateTicket) => http.patch<P.TicketDetail>(`${base}/tickets/${id}`, body),

    announcements: () => http.get<P.Announcement[]>(`${base}/announcements`),
    createAnnouncement: (body: P.UpsertAnnouncement) => http.post<P.Announcement>(`${base}/announcements`, body),
    updateAnnouncement: (id: string, body: P.UpdateAnnouncement) => http.patch<P.Announcement>(`${base}/announcements/${id}`, body),

    help: () => http.get<P.HelpArticle[]>(`${base}/help`),
    createHelp: (body: P.UpsertHelpArticle) => http.post<P.HelpArticle>(`${base}/help`, body),
    updateHelp: (id: string, body: P.UpdateHelpArticle) => http.patch<P.HelpArticle>(`${base}/help/${id}`, body),

    admins: () => http.get<P.PlatformAdmin[]>(`${base}/admins`),
    createAdmin: (body: P.CreatePlatformAdmin) => http.post<P.PlatformAdmin>(`${base}/admins`, body),
    updateAdmin: (id: string, body: P.UpdatePlatformAdmin) => http.patch<P.PlatformAdmin>(`${base}/admins/${id}`, body),
    audit: (q: { tenantId?: string; page?: number; pageSize?: number } = {}) => http.get<Paginated<P.AdminAuditEntry>>(`${base}/audit`, q),
    runLifecycle: () => http.post<P.LifecycleRunResult>(`${base}/lifecycle/run`),
  };
};

export type PlatformConsoleApi = ReturnType<typeof platformConsoleApi>;
