import type { Paginated, ops as O } from '@hms/shared';
import type { Http } from '../http';

/** Facility Services endpoints. Owned by the "ops" workstream. Types come from @hms/shared (ops.*). */
export const opsApi = (http: Http) => ({
  summary: () => http.get<O.OpsSummary>('/ops/summary'),
  assets: {
    list: (q: O.AssetQuery = {}) => http.get<Paginated<O.Asset>>('/ops/assets', q),
    get: (id: string) => http.get<O.Asset>(`/ops/assets/${id}`),
    create: (body: O.AssetInput) => http.post<O.Asset>('/ops/assets', body),
    update: (id: string, body: O.UpdateAsset) => http.patch<O.Asset>(`/ops/assets/${id}`, body),
  },
  workOrders: {
    list: (q: O.WorkOrderQuery = {}) => http.get<Paginated<O.WorkOrder>>('/ops/work-orders', q),
    create: (body: O.CreateWorkOrder) => http.post<O.WorkOrder>('/ops/work-orders', body),
    update: (id: string, body: O.UpdateWorkOrder) => http.patch<O.WorkOrder>(`/ops/work-orders/${id}`, body),
  },
  cssd: {
    sets: (q: { status?: O.CssdSetStatus; q?: string } = {}) => http.get<O.CssdSet[]>('/ops/cssd/sets', q),
    createSet: (body: O.CssdSetInput) => http.post<O.CssdSet>('/ops/cssd/sets', body),
    updateSet: (id: string, body: Partial<O.CssdSetInput>) => http.patch<O.CssdSet>(`/ops/cssd/sets/${id}`, body),
    cycles: (q: { page?: number; pageSize?: number } = {}) => http.get<Paginated<O.CssdCycle>>('/ops/cssd/cycles', q),
    startCycle: (body: O.StartCycle) => http.post<O.CssdCycle>('/ops/cssd/cycles', body),
    completeCycle: (id: string, body: O.CompleteCycle) => http.post<O.CssdCycle>(`/ops/cssd/cycles/${id}/complete`, body),
    issues: (q: { setId?: string; cycleId?: string; open?: 'true' | 'false' } = {}) => http.get<O.CssdIssue[]>('/ops/cssd/issues', q),
    issue: (body: O.IssueSet) => http.post<O.CssdIssue>('/ops/cssd/issues', body),
    returnSet: (issueId: string, body: O.ReturnSet = {}) => http.post<O.CssdIssue>(`/ops/cssd/issues/${issueId}/return`, body),
  },
  linen: {
    items: () => http.get<O.LinenItem[]>('/ops/linen/items'),
    createItem: (body: O.LinenItemInput) => http.post<O.LinenItem>('/ops/linen/items', body),
    updateItem: (id: string, body: Partial<O.LinenItemInput>) => http.patch<O.LinenItem>(`/ops/linen/items/${id}`, body),
    stock: () => http.get<O.LinenStock[]>('/ops/linen/stock'),
    txns: (q: O.LinenTxnQuery = {}) => http.get<Paginated<O.LinenTxn>>('/ops/linen/txns', q),
    record: (body: O.LinenTxnInput) => http.post<O.LinenTxn>('/ops/linen/txns', body),
  },
  ambulance: {
    vehicles: () => http.get<O.Vehicle[]>('/ops/ambulance/vehicles'),
    createVehicle: (body: O.VehicleInput) => http.post<O.Vehicle>('/ops/ambulance/vehicles', body),
    updateVehicle: (id: string, body: Partial<O.VehicleInput>) => http.patch<O.Vehicle>(`/ops/ambulance/vehicles/${id}`, body),
    trips: (q: O.TripQuery = {}) => http.get<Paginated<O.Trip>>('/ops/ambulance/trips', q),
    getTrip: (id: string) => http.get<O.Trip>(`/ops/ambulance/trips/${id}`),
    createTrip: (body: O.CreateTrip) => http.post<O.Trip>('/ops/ambulance/trips', body),
    tripAction: (id: string, body: O.TripAction) => http.post<O.Trip>(`/ops/ambulance/trips/${id}/actions`, body),
  },
  diet: {
    orders: (q: O.DietOrderQuery = {}) => http.get<Paginated<O.DietOrder>>('/ops/diet/orders', q),
    order: (body: O.DietOrderInput) => http.post<O.DietOrder>('/ops/diet/orders', body),
    stop: (id: string) => http.post<O.DietOrder>(`/ops/diet/orders/${id}/stop`),
    kitchenSheet: (q: O.KitchenSheetQuery) => http.get<O.KitchenSheet>('/ops/diet/kitchen-sheet', q),
    markMeal: (body: O.MarkMeal) => http.post<{ ok: true }>('/ops/diet/meals', body),
  },
  housekeeping: {
    list: (q: O.HkTaskQuery = {}) => http.get<Paginated<O.HkTask>>('/ops/housekeeping/tasks', q),
    create: (body: O.CreateHkTask) => http.post<O.HkTask>('/ops/housekeeping/tasks', body),
    update: (id: string, body: O.UpdateHkTask) => http.patch<O.HkTask>(`/ops/housekeeping/tasks/${id}`, body),
  },
});
