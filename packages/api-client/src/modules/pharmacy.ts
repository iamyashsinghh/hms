import type { ImportResult, Paginated, PaginationQuery, pharmacy } from '@hms/shared';
import type { Http } from '../http';

/** Pharmacy endpoints. Owned by the "pharmacy" workstream. Types come from @hms/shared (pharmacy.*). */
export const pharmacyApi = (http: Http) => ({
  items: {
    list: (q: pharmacy.ItemSearchQuery = {}) => http.get<Paginated<pharmacy.Item>>('/pharmacy/items', q),
    get: (id: string) => http.get<pharmacy.Item>(`/pharmacy/items/${id}`),
    create: (body: pharmacy.CreateItem) => http.post<pharmacy.Item>('/pharmacy/items', body),
    import: (body: pharmacy.ItemImport) => http.post<ImportResult>('/pharmacy/items/import', body),
    update: (id: string, body: pharmacy.UpdateItem) => http.patch<pharmacy.Item>(`/pharmacy/items/${id}`, body),
  },
  stores: {
    list: () => http.get<pharmacy.Store[]>('/pharmacy/stores'),
    create: (body: pharmacy.CreateStore) => http.post<pharmacy.Store>('/pharmacy/stores', body),
    update: (id: string, body: pharmacy.UpdateStore) => http.patch<pharmacy.Store>(`/pharmacy/stores/${id}`, body),
  },
  stock: {
    list: (q: pharmacy.StockQuery) => http.get<Paginated<pharmacy.StockRow>>('/pharmacy/stock', q),
    batches: (storeId: string, itemId: string) => http.get<pharmacy.BatchStock[]>(`/pharmacy/stores/${storeId}/items/${itemId}/batches`),
    expiring: (q: pharmacy.ExpiringQuery) => http.get<pharmacy.ExpiringBatch[]>('/pharmacy/stock/expiring', q),
    ledger: (q: pharmacy.LedgerQuery = {}) => http.get<Paginated<pharmacy.LedgerEntry>>('/pharmacy/stock/ledger', q),
    opening: (body: pharmacy.OpeningStock) => http.post<{ lines: number; units: number }>('/pharmacy/stock/opening', body),
    adjust: (body: pharmacy.StockAdjustment) => http.post<{ batchId: string; balance: number }>('/pharmacy/stock/adjustments', body),
  },
  grns: {
    list: (q: PaginationQuery = {}) => http.get<Paginated<pharmacy.Grn>>('/pharmacy/grns', q),
    get: (id: string) => http.get<pharmacy.Grn>(`/pharmacy/grns/${id}`),
    create: (body: pharmacy.CreateGrn) => http.post<pharmacy.Grn>('/pharmacy/grns', body),
  },
  sales: {
    list: (q: pharmacy.SaleListQuery = {}) => http.get<Paginated<pharmacy.Sale>>('/pharmacy/sales', q),
    get: (id: string) => http.get<pharmacy.Sale & { returns: pharmacy.SaleReturn[] }>(`/pharmacy/sales/${id}`),
    create: (body: pharmacy.CreateSale) => http.post<pharmacy.Sale>('/pharmacy/sales', body),
    createReturn: (id: string, body: pharmacy.CreateSaleReturn) => http.post<pharmacy.SaleReturn>(`/pharmacy/sales/${id}/returns`, body),
  },
  prescriptions: {
    list: (q: pharmacy.PrescriptionQuery = {}) => http.get<Paginated<pharmacy.Prescription>>('/pharmacy/prescriptions', q),
    get: (id: string) => http.get<pharmacy.Prescription>(`/pharmacy/prescriptions/${id}`),
    create: (body: pharmacy.CreatePrescription) => http.post<pharmacy.Prescription>('/pharmacy/prescriptions', body),
    cancel: (id: string) => http.post<pharmacy.Prescription>(`/pharmacy/prescriptions/${id}/cancel`),
    dispense: (id: string, body: pharmacy.Dispense) => http.post<pharmacy.Sale>(`/pharmacy/prescriptions/${id}/dispense`, body),
  },
});
