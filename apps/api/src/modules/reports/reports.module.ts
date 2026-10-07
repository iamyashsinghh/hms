import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsIngestService } from './reports.ingest';
import { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';

/**
 * Reports & MIS. Read-only: reports never writes another module's tables. The worker projects the
 * agreed events into reporting.* (ReportsIngestService); ReportsService answers dashboards and exports.
 * Other modules (notifications' 7 AM summary) import ReportsModule and call ReportsService.ownerSummaryForTenant().
 */
@Module({
  controllers: [ReportsController],
  providers: [ReportsService, ReportsRepository, ReportsIngestService],
  exports: [ReportsService],
})
export class ReportsModule {}
