import { Controller, Get, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { reports } from '@hms/shared';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { RequireEntitlement } from '../platform';
import { ReportsService } from './reports.service';

@Controller('reports')
@RequireEntitlement('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Owner app home screen and the morning summary. */
  @Get('owner-summary')
  @RequirePermissions('reports.dashboard.read')
  ownerSummary(@Query(new ZodPipe(reports.ownerSummaryQuerySchema)) q: { date?: string; facilityId?: string }): Promise<reports.OwnerSummary> {
    return this.reports.ownerSummary(q.date, q.facilityId);
  }

  @Get('dashboard')
  @RequirePermissions('reports.dashboard.read')
  dashboard(@Query(new ZodPipe(reports.reportRangeQuerySchema)) q: reports.ReportRangeParams): Promise<reports.DashboardReport> {
    return this.reports.dashboard(q);
  }

  @Get('daily-collection')
  @RequirePermissions('reports.collection.read')
  dailyCollection(
    @Query(new ZodPipe(reports.dailyCollectionQuerySchema)) q: { date?: string; facilityId?: string },
  ): Promise<reports.DailyCollectionReport> {
    return this.reports.dailyCollection(q.date, q.facilityId);
  }

  /** Day-end check of charges still unbilled on patients' accounts (billing desk). */
  @Get('unbilled')
  @RequirePermissions('reports.collection.read')
  unbilled(@Query(new ZodPipe(reports.unbilledQuerySchema)) q: { date?: string; facilityId?: string }): Promise<reports.UnbilledChargesReport> {
    return this.reports.unbilled(q.date, q.facilityId);
  }

  @Get('opd')
  @RequirePermissions('reports.opd.read')
  opd(@Query(new ZodPipe(reports.reportRangeQuerySchema)) q: reports.ReportRangeParams): Promise<reports.OpdReport> {
    return this.reports.opd(q);
  }

  @Get('revenue')
  @RequirePermissions('reports.revenue.read')
  revenue(@Query(new ZodPipe(reports.reportRangeQuerySchema)) q: reports.ReportRangeParams): Promise<reports.RevenueReport> {
    return this.reports.revenue(q);
  }

  @Get('patients')
  @RequirePermissions('reports.patient.read')
  patients(@Query(new ZodPipe(reports.reportRangeQuerySchema)) q: reports.ReportRangeParams): Promise<reports.PatientsReport> {
    return this.reports.patients(q);
  }

  /**
   * CSV download. Needs reports.export.create plus the permission of the report being exported,
   * which the service checks (collections -> collection.read, opd-visits -> opd.read, ...).
   */
  @Get('export')
  @RequirePermissions('reports.export.create')
  async export(@Query(new ZodPipe(reports.exportQuerySchema)) q: reports.ExportParams, @Res({ passthrough: true }) res: FastifyReply): Promise<string> {
    const { filename, csv } = await this.reports.export(q);
    res.header('content-type', 'text/csv; charset=utf-8');
    res.header('content-disposition', `attachment; filename="${filename}"`);
    res.header('cache-control', 'no-store');
    return csv;
  }
}
