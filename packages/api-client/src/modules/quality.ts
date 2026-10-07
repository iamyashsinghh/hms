import type { Paginated, quality as Q } from '@hms/shared';
import type { Http } from '../http';

/** Quality & NABH endpoints. Owned by the "quality" workstream. Types come from @hms/shared (quality.*). */
export const qualityApi = (http: Http) => ({
  dashboard: (period?: string) => http.get<Q.QualityDashboard>('/quality/dashboard', { period }),
  staff: () => http.get<Q.Person[]>('/quality/staff'),
  indicators: {
    list: (period?: string) => http.get<Q.IndicatorResult[]>('/quality/indicators', { period }),
    trend: (code: string, q: { months?: number; to?: string } = {}) => http.get<Q.IndicatorResult[]>(`/quality/indicators/${code}/trend`, q),
    saveValue: (code: string, body: Q.IndicatorValueInput) => http.put<Q.IndicatorResult>(`/quality/indicators/${code}/values`, body),
  },
  incidents: {
    report: (body: Q.ReportIncident) => http.post<Q.Incident>('/quality/incidents', body),
    list: (q: Q.IncidentQuery = {}) => http.get<Paginated<Q.IncidentSummary>>('/quality/incidents', q),
    mine: (q: Q.IncidentQuery = {}) => http.get<Paginated<Q.IncidentSummary>>('/quality/incidents/mine', q),
    get: (id: string) => http.get<Q.Incident>(`/quality/incidents/${id}`),
    review: (id: string, body: Q.ReviewIncident) => http.patch<Q.Incident>(`/quality/incidents/${id}`, body),
  },
  complaints: {
    create: (body: Q.CreateComplaint) => http.post<Q.Complaint>('/quality/complaints', body),
    list: (q: Q.ComplaintQuery = {}) => http.get<Paginated<Q.ComplaintSummary>>('/quality/complaints', q),
    get: (id: string) => http.get<Q.Complaint>(`/quality/complaints/${id}`),
    update: (id: string, body: Q.UpdateComplaint) => http.patch<Q.Complaint>(`/quality/complaints/${id}`, body),
  },
  hai: {
    create: (body: Q.CreateHai) => http.post<Q.HaiCase>('/quality/hai', body),
    list: (q: Q.HaiQuery = {}) => http.get<Paginated<Q.HaiCase>>('/quality/hai', q),
    get: (id: string) => http.get<Q.HaiCase>(`/quality/hai/${id}`),
    update: (id: string, body: Q.UpdateHai) => http.patch<Q.HaiCase>(`/quality/hai/${id}`, body),
  },
  census: {
    list: (q: { from?: string; to?: string } = {}) => http.get<Q.CensusDay[]>('/quality/census', q),
    save: (body: Q.CensusInput) => http.put<Q.CensusDay>('/quality/census', body),
  },
  checklists: {
    list: (all = false) => http.get<Q.Checklist[]>('/quality/checklists', { all: all ? 'true' : undefined }),
    get: (id: string) => http.get<Q.Checklist>(`/quality/checklists/${id}`),
    create: (body: Q.ChecklistInput) => http.post<Q.Checklist>('/quality/checklists', body),
    update: (id: string, body: Q.ChecklistInput) => http.put<Q.Checklist>(`/quality/checklists/${id}`, body),
  },
  audits: {
    list: (q: Q.AuditQuery = {}) => http.get<Paginated<Q.AuditSummary>>('/quality/audits', q),
    get: (id: string) => http.get<Q.Audit>(`/quality/audits/${id}`),
    schedule: (body: Q.ScheduleAudit) => http.post<Q.Audit>('/quality/audits', body),
    submit: (id: string, body: Q.SubmitAudit) => http.post<Q.Audit>(`/quality/audits/${id}/submit`, body),
    cancel: (id: string) => http.post<Q.Audit>(`/quality/audits/${id}/cancel`),
  },
  capas: {
    list: (q: Q.CapaQuery = {}) => http.get<Paginated<Q.CapaSummary>>('/quality/capas', q),
    get: (id: string) => http.get<Q.Capa>(`/quality/capas/${id}`),
    create: (body: Q.CreateCapa) => http.post<Q.Capa>('/quality/capas', body),
    update: (id: string, body: Q.UpdateCapa) => http.patch<Q.Capa>(`/quality/capas/${id}`, body),
  },
  documents: {
    list: (q: Q.DocumentQuery = {}) => http.get<Paginated<Q.DocumentSummary>>('/quality/documents', q),
    get: (id: string) => http.get<Q.QualityDocument>(`/quality/documents/${id}`),
    create: (body: Q.CreateDocument) => http.post<Q.QualityDocument>('/quality/documents', body),
    update: (id: string, body: Q.UpdateDocument) => http.patch<Q.QualityDocument>(`/quality/documents/${id}`, body),
    approve: (id: string) => http.post<Q.QualityDocument>(`/quality/documents/${id}/approve`),
    revise: (id: string) => http.post<Q.QualityDocument>(`/quality/documents/${id}/revise`),
    archive: (id: string) => http.post<Q.QualityDocument>(`/quality/documents/${id}/archive`),
  },
});
