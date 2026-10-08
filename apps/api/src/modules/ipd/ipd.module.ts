import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { InsuranceModule } from '../insurance/insurance.module';
import { PatientsModule } from '../patients/patients.module';
import { SetupModule } from '../setup/setup.module';
import { IpdCensusService } from './ipd.census';
import { IpdController } from './ipd.controller';
import { IpdPlanLimits } from './ipd.limits';
import { IpdRepository } from './ipd.repository';
import { IpdService } from './ipd.service';

/**
 * IPD & Nursing. Owned by the "ipd" workstream (see PARALLEL_PLAN.md).
 * Wards/beds, admissions, transfers, nursing charts, MAR, rounds, running bill (the stay's charges on the
 * patient account, via ChargesService; approved pre-auth via InsuranceService) and discharge.
 * Permissions and Zod contracts live in packages/shared/src/modules/ipd.ts.
 */
@Module({
  imports: [BillingModule, InsuranceModule, PatientsModule, SetupModule],
  controllers: [IpdController],
  providers: [IpdService, IpdRepository, IpdPlanLimits, IpdCensusService],
  exports: [IpdService],
})
export class IpdModule {}
