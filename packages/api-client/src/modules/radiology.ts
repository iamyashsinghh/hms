import type { ImportRequest, ImportResult, Paginated, radiology as r } from '@hms/shared';
import type { Http } from '../http';

/** Radiology endpoints. Owned by the "radiology" workstream. Types come from @hms/shared (radiology.*). */
export const radiologyApi = (http: Http) => ({
  modalities: (q: r.MasterQuery = {}) => http.get<r.Modality[]>('/radiology/modalities', q),
  createModality: (body: r.ModalityInput) => http.post<r.Modality>('/radiology/modalities', body),
  updateModality: (id: string, body: r.UpdateModality) => http.patch<r.Modality>(`/radiology/modalities/${id}`, body),

  tests: (q: r.MasterQuery = {}) => http.get<r.RadiologyTest[]>('/radiology/tests', q),
  test: (id: string) => http.get<r.RadiologyTest>(`/radiology/tests/${id}`),
  createTest: (body: r.TestInput) => http.post<r.RadiologyTest>('/radiology/tests', body),
  importTests: (body: ImportRequest) => http.post<ImportResult>('/radiology/tests/import', body),
  updateTest: (id: string, body: r.UpdateTest) => http.patch<r.RadiologyTest>(`/radiology/tests/${id}`, body),

  templates: (q: r.MasterQuery = {}) => http.get<r.ReportTemplate[]>('/radiology/templates', q),
  template: (id: string) => http.get<r.ReportTemplate>(`/radiology/templates/${id}`),
  createTemplate: (body: r.TemplateInput) => http.post<r.ReportTemplate>('/radiology/templates', body),
  updateTemplate: (id: string, body: r.UpdateTemplate) => http.patch<r.ReportTemplate>(`/radiology/templates/${id}`, body),
  loadStarterMasters: () => http.post<{ modalities: number; tests: number; templates: number }>('/radiology/masters/starter', {}),

  orders: (q: r.OrderQuery = {}) => http.get<Paginated<r.RadiologyOrder>>('/radiology/orders', q),
  order: (id: string) => http.get<r.OrderWithReports>(`/radiology/orders/${id}`),
  createOrder: (body: r.CreateOrder) => http.post<r.RadiologyOrder>('/radiology/orders', body),
  updateOrder: (id: string, body: r.UpdateOrder) => http.patch<r.RadiologyOrder>(`/radiology/orders/${id}`, body),
  schedule: (id: string, body: r.ScheduleOrder) => http.post<r.RadiologyOrder>(`/radiology/orders/${id}/schedule`, body),
  start: (id: string) => http.post<r.RadiologyOrder>(`/radiology/orders/${id}/start`, {}),
  complete: (id: string, body: r.CompleteScan = {}) => http.post<r.RadiologyOrder>(`/radiology/orders/${id}/complete`, body),
  cancel: (id: string, body: r.CancelOrder) => http.post<r.RadiologyOrder>(`/radiology/orders/${id}/cancel`, body),
  bill: (id: string, body: r.BillOrder = {}) => http.post<r.RadiologyOrder>(`/radiology/orders/${id}/bill`, body),
  scheduleFor: (q: r.ScheduleQuery) => http.get<r.ScheduleEntry[]>('/radiology/schedule', q),

  saveReport: (orderId: string, body: r.SaveReport) => http.put<r.OrderWithReports>(`/radiology/orders/${orderId}/report`, body),
  discardDraft: (orderId: string) => http.delete<r.OrderWithReports>(`/radiology/orders/${orderId}/report/draft`),
  finalizeReport: (orderId: string) => http.post<r.OrderWithReports>(`/radiology/orders/${orderId}/report/finalize`, {}),
  amendReport: (orderId: string, body: r.AmendReport) => http.post<r.OrderWithReports>(`/radiology/orders/${orderId}/report/amend`, body),
  report: (id: string) => http.get<r.ReportDocument>(`/radiology/reports/${id}`),
});
