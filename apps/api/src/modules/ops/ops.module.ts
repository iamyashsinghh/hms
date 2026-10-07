import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { PatientsModule } from '../patients/patients.module';
import { AmbulanceService } from './ambulance.service';
import { AssetsService } from './assets.service';
import { CssdService } from './cssd.service';
import { DietService } from './diet.service';
import { HousekeepingService } from './housekeeping.service';
import { LinenService } from './linen.service';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';

/**
 * Facility Services. Owned by the "ops" workstream (see PARALLEL_PLAN.md): biomedical equipment and
 * maintenance, CSSD, linen & laundry, ambulance, diet kitchen and housekeeping.
 * Permissions and Zod contracts live in packages/shared/src/modules/ops.ts.
 * Events: ops.asset.breakdown_reported, ops.cssd.cycle_failed, ops.trip.completed (payload types in the shared file).
 * Ambulance trips are billed through BillingService.createInvoice (source module 'ops').
 */
@Module({
  imports: [BillingModule, PatientsModule],
  controllers: [OpsController],
  providers: [OpsService, AssetsService, CssdService, LinenService, AmbulanceService, DietService, HousekeepingService],
})
export class OpsModule {}
