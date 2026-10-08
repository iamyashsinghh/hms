import type { Paginated, crm as C } from '@hms/shared';
import type { Http } from '../http';

/** Referral & CRM endpoints. Owned by the "crm" workstream. Types come from @hms/shared (crm.*). */
export const crmApi = (http: Http) => ({
  dashboard: () => http.get<C.CrmDashboard>('/crm/dashboard'),
  staff: () => http.get<C.CrmStaff[]>('/crm/staff'),
  leads: {
    list: (q: C.LeadQuery = {}) => http.get<Paginated<C.Lead>>('/crm/leads', q),
    get: (id: string) => http.get<C.LeadDetail>(`/crm/leads/${id}`),
    create: (body: C.LeadInput) => http.post<C.LeadDetail>('/crm/leads', body),
    update: (id: string, body: C.UpdateLead) => http.patch<C.LeadDetail>(`/crm/leads/${id}`, body),
    addActivity: (id: string, body: C.LeadActivityInput) => http.post<C.LeadDetail>(`/crm/leads/${id}/activities`, body),
    lose: (id: string, body: C.LoseLead) => http.post<C.LeadDetail>(`/crm/leads/${id}/lose`, body),
    reopen: (id: string) => http.post<C.LeadDetail>(`/crm/leads/${id}/reopen`),
    convert: (id: string, body: C.ConvertLead) => http.post<C.LeadDetail>(`/crm/leads/${id}/convert`, body),
  },
  referrers: {
    list: (q: C.ReferrerQuery = {}) => http.get<Paginated<C.ReferrerSummary>>('/crm/referrers', q),
    get: (id: string) => http.get<C.ReferrerSummary>(`/crm/referrers/${id}`),
    create: (body: C.ReferrerInput) => http.post<C.Referrer>('/crm/referrers', body),
    update: (id: string, body: C.UpdateReferrer) => http.patch<C.Referrer>(`/crm/referrers/${id}`, body),
  },
  rules: {
    list: (referrerId?: string) => http.get<C.CommissionRule[]>('/crm/commission-rules', { referrerId }),
    create: (body: C.CommissionRuleInput) => http.post<C.CommissionRule>('/crm/commission-rules', body),
    update: (id: string, body: C.CommissionRuleInput) => http.put<C.CommissionRule>(`/crm/commission-rules/${id}`, body),
  },
  referrals: {
    list: (q: C.ReferralQuery = {}) => http.get<Paginated<C.Referral>>('/crm/referrals', q),
    create: (body: C.ReferralInput) => http.post<C.Referral>('/crm/referrals', body),
    close: (id: string) => http.post<C.Referral>(`/crm/referrals/${id}/close`),
  },
  commissions: {
    list: (q: C.CommissionQuery = {}) => http.get<Paginated<C.Commission>>('/crm/commissions', q),
  },
  statements: {
    list: (q: C.StatementQuery = {}) => http.get<Paginated<C.CommissionStatement>>('/crm/statements', q),
    get: (id: string) => http.get<C.CommissionStatementDetail>(`/crm/statements/${id}`),
    create: (body: C.CreateStatement) => http.post<C.CommissionStatementDetail>('/crm/statements', body),
    approve: (id: string) => http.post<C.CommissionStatementDetail>(`/crm/statements/${id}/approve`),
    pay: (id: string, body: C.PayStatement) => http.post<C.CommissionStatementDetail>(`/crm/statements/${id}/pay`, body),
    cancel: (id: string) => http.post<C.CommissionStatementDetail>(`/crm/statements/${id}/cancel`),
  },
  camps: {
    list: (q: C.CampQuery = {}) => http.get<Paginated<C.Camp>>('/crm/camps', q),
    get: (id: string) => http.get<C.Camp>(`/crm/camps/${id}`),
    create: (body: C.CampInput) => http.post<C.Camp>('/crm/camps', body),
    update: (id: string, body: C.UpdateCamp) => http.patch<C.Camp>(`/crm/camps/${id}`, body),
  },
  campaigns: {
    list: () => http.get<C.Campaign[]>('/crm/campaigns'),
    get: (id: string) => http.get<C.Campaign>(`/crm/campaigns/${id}`),
    create: (body: C.CampaignInput) => http.post<C.Campaign>('/crm/campaigns', body),
    update: (id: string, body: C.CampaignInput) => http.put<C.Campaign>(`/crm/campaigns/${id}`, body),
    send: (id: string) => http.post<C.Campaign>(`/crm/campaigns/${id}/send`),
    cancel: (id: string) => http.post<C.Campaign>(`/crm/campaigns/${id}/cancel`),
  },
  followUps: {
    list: (q: C.FollowUpQuery = {}) => http.get<Paginated<C.FollowUp>>('/crm/follow-ups', q),
    get: (id: string) => http.get<C.FollowUp>(`/crm/follow-ups/${id}`),
    create: (body: C.FollowUpInput) => http.post<C.FollowUp>('/crm/follow-ups', body),
    update: (id: string, body: C.UpdateFollowUp) => http.patch<C.FollowUp>(`/crm/follow-ups/${id}`, body),
    close: (id: string, body: C.CloseFollowUp) => http.post<C.FollowUp>(`/crm/follow-ups/${id}/close`, body),
    remind: (id: string, body: C.RemindFollowUp = {}) =>
      http.post<C.FollowUp & { queued: number; reason: string | null }>(`/crm/follow-ups/${id}/remind`, body),
    remindDue: (date?: string) => http.post<C.RemindDueResult>('/crm/follow-ups/remind-due', { date }),
  },
});
