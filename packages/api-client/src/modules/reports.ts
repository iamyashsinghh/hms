import type { reports } from '@hms/shared';
import type { Http } from '../http';

/** Reports & MIS endpoints. Owned by the "reports" workstream. Types come from @hms/shared (reports.*). */
export const reportsApi = (http: Http) => ({
  ownerSummary: (q: reports.OwnerSummaryQuery = {}) => http.get<reports.OwnerSummary>('/reports/owner-summary', q),
  dashboard: (q: reports.ReportRangeQuery) => http.get<reports.DashboardReport>('/reports/dashboard', q),
  dailyCollection: (q: reports.DailyCollectionQuery = {}) => http.get<reports.DailyCollectionReport>('/reports/daily-collection', q),
  opd: (q: reports.ReportRangeQuery) => http.get<reports.OpdReport>('/reports/opd', q),
  revenue: (q: reports.ReportRangeQuery) => http.get<reports.RevenueReport>('/reports/revenue', q),
  patients: (q: reports.ReportRangeQuery) => http.get<reports.PatientsReport>('/reports/patients', q),
  /**
   * Path + query of a CSV export (relative to the API base URL). The response is text/csv, not JSON,
   * so fetch it with the access token yourself (see apps/web/src/modules/reports/download.ts).
   */
  exportPath: (q: reports.ExportQuery) => {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    return `/reports/export?${qs.toString()}`;
  },
});
