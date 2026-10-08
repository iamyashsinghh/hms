import type { ImportRequest, ImportResult, Paginated, billing as B } from '@hms/shared';
import type { Http } from '../http';

/** Billing endpoints. Owned by the "billing" workstream. Types come from @hms/shared (billing.*). */
export const billingApi = (http: Http) => ({
  settings: {
    get: () => http.get<B.BillingSettings>('/billing/settings'),
    update: (body: B.BillingSettingsInput) => http.put<B.BillingSettings>('/billing/settings', body),
  },
  services: {
    list: (q: B.ServiceQuery = {}) => http.get<Paginated<B.Service>>('/billing/services', q),
    get: (id: string) => http.get<B.Service>(`/billing/services/${id}`),
    price: (code: string, payerId?: string) => http.get<B.ServicePrice>('/billing/services/price', { code, payerId }),
    create: (body: B.CreateService) => http.post<B.Service>('/billing/services', body),
    import: (body: ImportRequest) => http.post<ImportResult>('/billing/services/import', body),
    update: (id: string, body: B.UpdateService) => http.patch<B.Service>(`/billing/services/${id}`, body),
  },
  priceLists: {
    list: () => http.get<B.PriceList[]>('/billing/price-lists'),
    get: (id: string) => http.get<B.PriceList>(`/billing/price-lists/${id}`),
    create: (body: B.PriceListInput) => http.post<B.PriceList>('/billing/price-lists', body),
    update: (id: string, body: B.PriceListInput) => http.put<B.PriceList>(`/billing/price-lists/${id}`, body),
  },
  invoices: {
    list: (q: B.InvoiceQuery = {}) => http.get<Paginated<B.InvoiceSummary>>('/billing/invoices', q),
    get: (id: string) => http.get<B.Invoice>(`/billing/invoices/${id}`),
    create: (body: B.CreateInvoice) => http.post<B.Invoice>('/billing/invoices', body),
    update: (id: string, body: B.UpdateInvoice) => http.patch<B.Invoice>(`/billing/invoices/${id}`, body),
    remove: (id: string) => http.delete<void>(`/billing/invoices/${id}`),
    finalize: (id: string) => http.post<B.Invoice>(`/billing/invoices/${id}/finalize`),
    cancel: (id: string, body: B.CancelInvoice) => http.post<B.Invoice>(`/billing/invoices/${id}/cancel`, body),
    pay: (id: string, body: B.CollectPayment) => http.post<B.Invoice>(`/billing/invoices/${id}/payments`, body),
    creditNote: (id: string, body: B.CreditNoteInput) => http.post<B.Invoice>(`/billing/invoices/${id}/credit-notes`, body),
  },
  payments: {
    list: (q: B.PaymentQuery = {}) => http.get<Paginated<B.Payment>>('/billing/payments', q),
    get: (id: string) => http.get<B.Payment>(`/billing/payments/${id}`),
    deposit: (body: B.DepositInput) => http.post<B.Payment>('/billing/deposits', body),
    refund: (body: B.RefundInput) => http.post<B.Payment>('/billing/refunds', body),
  },
  account: (patientId: string) => http.get<B.PatientAccount>(`/billing/patients/${patientId}/account`),
  shifts: {
    current: () => http.get<{ shift: B.CashShift | null }>('/billing/shifts/current'),
    open: (body: B.OpenShift) => http.post<B.CashShift>('/billing/shifts/open', body),
    close: (body: B.CloseShift) => http.post<B.CashShift>('/billing/shifts/close', body),
    list: (q: { userId?: string; from?: string; to?: string; page?: number; pageSize?: number } = {}) =>
      http.get<Paginated<B.CashShift>>('/billing/shifts', q),
    get: (id: string) => http.get<B.CashShift>(`/billing/shifts/${id}`),
  },
});
