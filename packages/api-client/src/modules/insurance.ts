import type { Paginated, insurance as I } from '@hms/shared';
import type { Http } from '../http';

/** Insurance & Schemes endpoints. Owned by the "insurance" workstream. Types come from @hms/shared (insurance.*). */
export const insuranceApi = (http: Http) => ({
  payers: {
    list: (q: I.PayerQuery = {}) => http.get<Paginated<I.Payer>>('/insurance/payers', q),
    get: (id: string) => http.get<I.Payer>(`/insurance/payers/${id}`),
    create: (body: I.PayerInput) => http.post<I.Payer>('/insurance/payers', body),
    update: (id: string, body: I.UpdatePayer) => http.patch<I.Payer>(`/insurance/payers/${id}`, body),
    packages: (id: string, all = false) => http.get<I.SchemePackage[]>(`/insurance/payers/${id}/packages`, { all: String(all) }),
    createPackage: (id: string, body: I.PackageInput) => http.post<I.SchemePackage>(`/insurance/payers/${id}/packages`, body),
    updatePackage: (id: string, packageId: string, body: I.UpdatePackage) =>
      http.patch<I.SchemePackage>(`/insurance/payers/${id}/packages/${packageId}`, body),
  },
  policies: {
    list: (q: I.PolicyQuery = {}) => http.get<Paginated<I.Policy>>('/insurance/policies', q),
    get: (id: string) => http.get<I.Policy>(`/insurance/policies/${id}`),
    create: (body: I.PolicyInput) => http.post<I.Policy>('/insurance/policies', body),
    update: (id: string, body: I.UpdatePolicy) => http.patch<I.Policy>(`/insurance/policies/${id}`, body),
    verify: (id: string) => http.post<I.EligibilityResult>(`/insurance/policies/${id}/verify`),
  },
  preauths: {
    list: (q: I.PreauthQuery = {}) => http.get<Paginated<I.PreauthSummary>>('/insurance/preauths', q),
    get: (id: string) => http.get<I.Preauth>(`/insurance/preauths/${id}`),
    create: (body: I.PreauthInput) => http.post<I.Preauth>('/insurance/preauths', body),
    update: (id: string, body: I.UpdatePreauth) => http.patch<I.Preauth>(`/insurance/preauths/${id}`, body),
    submit: (id: string, body: I.SubmitInput = {}) => http.post<I.Preauth>(`/insurance/preauths/${id}/submit`, body),
    query: (id: string, body: I.ReasonInput) => http.post<I.Preauth>(`/insurance/preauths/${id}/query`, body),
    approve: (id: string, body: I.PreauthApprove) => http.post<I.Preauth>(`/insurance/preauths/${id}/approve`, body),
    reject: (id: string, body: I.ReasonInput) => http.post<I.Preauth>(`/insurance/preauths/${id}/reject`, body),
    cancel: (id: string, body: I.ReasonInput) => http.post<I.Preauth>(`/insurance/preauths/${id}/cancel`, body),
    enhance: (id: string, body: I.PreauthEnhance) => http.post<I.Preauth>(`/insurance/preauths/${id}/enhance`, body),
  },
  claims: {
    list: (q: I.ClaimQuery = {}) => http.get<Paginated<I.ClaimSummary>>('/insurance/claims', q),
    get: (id: string) => http.get<I.Claim>(`/insurance/claims/${id}`),
    create: (body: I.ClaimInput) => http.post<I.Claim>('/insurance/claims', body),
    update: (id: string, body: I.UpdateClaim) => http.patch<I.Claim>(`/insurance/claims/${id}`, body),
    submit: (id: string, body: I.SubmitInput = {}) => http.post<I.Claim>(`/insurance/claims/${id}/submit`, body),
    query: (id: string, body: I.ReasonInput) => http.post<I.Claim>(`/insurance/claims/${id}/query`, body),
    approve: (id: string, body: I.ClaimApprove) => http.post<I.Claim>(`/insurance/claims/${id}/approve`, body),
    reject: (id: string, body: I.ReasonInput) => http.post<I.Claim>(`/insurance/claims/${id}/reject`, body),
    cancel: (id: string, body: I.ReasonInput) => http.post<I.Claim>(`/insurance/claims/${id}/cancel`, body),
    addDocument: (id: string, body: I.DocumentInput) => http.post<I.Claim>(`/insurance/claims/${id}/documents`, body),
    updateDocument: (id: string, docId: string, body: I.UpdateDocument) => http.patch<I.Claim>(`/insurance/claims/${id}/documents/${docId}`, body),
    removeDocument: (id: string, docId: string) => http.delete<I.Claim>(`/insurance/claims/${id}/documents/${docId}`),
    settle: (id: string, body: I.SettlementInput) => http.post<I.Claim>(`/insurance/claims/${id}/settlements`, body),
    retryPosting: (settlementId: string) => http.post<I.Claim>(`/insurance/settlements/${settlementId}/post`),
  },
  invoiceSplit: (invoiceId: string) => http.get<I.InvoiceSplit>(`/insurance/invoices/${invoiceId}/split`),
  summary: () => http.get<I.InsuranceSummary>('/insurance/summary'),
});
