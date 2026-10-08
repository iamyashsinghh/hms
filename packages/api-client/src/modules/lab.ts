import type { ImportRequest, ImportResult, Paginated, lab as L } from '@hms/shared';
import type { Http } from '../http';

/** Laboratory endpoints. Owned by the "lab" workstream. Types come from @hms/shared (lab.*). */
export const labApi = (http: Http) => ({
  tests: {
    list: (q: L.CatalogueQuery = {}) => http.get<L.LabTest[]>('/lab/tests', q),
    get: (id: string) => http.get<L.LabTest>(`/lab/tests/${id}`),
    create: (body: L.TestInput) => http.post<L.LabTest>('/lab/tests', body),
    import: (body: ImportRequest) => http.post<ImportResult>('/lab/tests/import', body),
    update: (id: string, body: L.UpdateTest) => http.patch<L.LabTest>(`/lab/tests/${id}`, body),
  },
  panels: {
    list: (q: L.CatalogueQuery = {}) => http.get<L.LabPanel[]>('/lab/panels', q),
    get: (id: string) => http.get<L.LabPanel>(`/lab/panels/${id}`),
    create: (body: L.PanelInput) => http.post<L.LabPanel>('/lab/panels', body),
    update: (id: string, body: L.UpdatePanel) => http.patch<L.LabPanel>(`/lab/panels/${id}`, body),
  },
  orderables: (q: L.CatalogueQuery = {}) => http.get<L.Orderable[]>('/lab/orderables', q),
  loadStarterCatalogue: () => http.post<{ testsAdded: number; panelsAdded: number }>('/lab/catalogue/starter'),
  orders: {
    list: (q: L.OrderQuery = {}) => http.get<Paginated<L.OrderSummary>>('/lab/orders', q),
    get: (id: string) => http.get<L.Order>(`/lab/orders/${id}`),
    create: (body: L.CreateOrder) => http.post<L.Order>('/lab/orders', body),
    update: (id: string, body: L.UpdateOrder) => http.patch<L.Order>(`/lab/orders/${id}`, body),
    report: (id: string) => http.get<L.Report>(`/lab/orders/${id}/report`),
    bill: (id: string, body: { payNow?: L.CreateOrder['payNow'] } = {}) => http.post<L.Order>(`/lab/orders/${id}/bill`, body),
    cancel: (id: string, body: L.CancelOrder) => http.post<L.Order>(`/lab/orders/${id}/cancel`, body),
    collectAll: (id: string) => http.post<L.Order>(`/lab/orders/${id}/collect`),
    enterResults: (id: string, body: L.EnterResults) => http.put<L.Order>(`/lab/orders/${id}/results`, body),
    verify: (id: string, body: L.Verify = {}) => http.post<L.Order>(`/lab/orders/${id}/verify`, body),
    amend: (id: string, body: L.Amend) => http.post<L.Order>(`/lab/orders/${id}/amend`, body),
  },
  samples: {
    worklist: (status: L.SampleStatus = 'pending') => http.get<L.WorklistSample[]>('/lab/samples', { status }),
    collect: (id: string) => http.post<L.Order>(`/lab/samples/${id}/collect`),
    receive: (id: string) => http.post<L.Order>(`/lab/samples/${id}/receive`),
    reject: (id: string, body: L.RejectSample) => http.post<L.Order>(`/lab/samples/${id}/reject`, body),
    recollect: (id: string) => http.post<L.Order>(`/lab/samples/${id}/recollect`),
  },
});
