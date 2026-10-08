import type { inventory, Paginated } from '@hms/shared';
import type { Http } from '../http';

/** Inventory & Procurement endpoints. Owned by the "inventory" workstream. Types come from @hms/shared (inventory.*). */
export const inventoryApi = (http: Http) => ({
  vendors: {
    list: (q: inventory.VendorQuery = {}) => http.get<Paginated<inventory.Vendor>>('/inventory/vendors', q),
    get: (id: string) => http.get<inventory.Vendor>(`/inventory/vendors/${id}`),
    create: (body: inventory.CreateVendor) => http.post<inventory.Vendor>('/inventory/vendors', body),
    update: (id: string, body: inventory.UpdateVendor) => http.patch<inventory.Vendor>(`/inventory/vendors/${id}`, body),
  },
  requisitions: {
    list: (q: inventory.RequisitionQuery = {}) => http.get<Paginated<inventory.Requisition>>('/inventory/requisitions', q),
    get: (id: string) => http.get<inventory.Requisition>(`/inventory/requisitions/${id}`),
    create: (body: inventory.CreateRequisition) => http.post<inventory.Requisition>('/inventory/requisitions', body),
    update: (id: string, body: inventory.UpdateRequisition) => http.patch<inventory.Requisition>(`/inventory/requisitions/${id}`, body),
    decide: (id: string, body: inventory.Decision) => http.post<inventory.Requisition>(`/inventory/requisitions/${id}/decision`, body),
    cancel: (id: string) => http.post<inventory.Requisition>(`/inventory/requisitions/${id}/cancel`),
  },
  purchaseOrders: {
    list: (q: inventory.PurchaseOrderQuery = {}) => http.get<Paginated<inventory.PurchaseOrder>>('/inventory/purchase-orders', q),
    get: (id: string) => http.get<inventory.PurchaseOrder>(`/inventory/purchase-orders/${id}`),
    create: (body: inventory.CreatePurchaseOrder) => http.post<inventory.PurchaseOrder>('/inventory/purchase-orders', body),
    update: (id: string, body: inventory.UpdatePurchaseOrder) => http.patch<inventory.PurchaseOrder>(`/inventory/purchase-orders/${id}`, body),
    approve: (id: string) => http.post<inventory.PurchaseOrder>(`/inventory/purchase-orders/${id}/approve`),
    cancel: (id: string, body: inventory.ClosePurchaseOrder) => http.post<inventory.PurchaseOrder>(`/inventory/purchase-orders/${id}/cancel`, body),
    close: (id: string, body: inventory.ClosePurchaseOrder) => http.post<inventory.PurchaseOrder>(`/inventory/purchase-orders/${id}/close`, body),
  },
  grns: {
    list: (q: inventory.GrnQuery = {}) => http.get<Paginated<inventory.Grn>>('/inventory/grns', q),
    get: (id: string) => http.get<inventory.Grn>(`/inventory/grns/${id}`),
    create: (body: inventory.CreateGrn) => http.post<inventory.Grn>('/inventory/grns', body),
    createReturn: (id: string, body: inventory.CreatePurchaseReturn) => http.post<inventory.PurchaseReturn>(`/inventory/grns/${id}/returns`, body),
  },
  indents: {
    list: (q: inventory.IndentQuery = {}) => http.get<Paginated<inventory.Indent>>('/inventory/indents', q),
    get: (id: string) => http.get<inventory.Indent>(`/inventory/indents/${id}`),
    create: (body: inventory.CreateIndent) => http.post<inventory.Indent>('/inventory/indents', body),
    update: (id: string, body: inventory.UpdateIndent) => http.patch<inventory.Indent>(`/inventory/indents/${id}`, body),
    decide: (id: string, body: inventory.DecideIndent) => http.post<inventory.Indent>(`/inventory/indents/${id}/decision`, body),
    cancel: (id: string) => http.post<inventory.Indent>(`/inventory/indents/${id}/cancel`),
    close: (id: string, body: inventory.CloseIndent) => http.post<inventory.Indent>(`/inventory/indents/${id}/close`, body),
    issue: (id: string, body: inventory.IssueIndent) => http.post<inventory.Indent>(`/inventory/indents/${id}/issue`, body),
  },
});
