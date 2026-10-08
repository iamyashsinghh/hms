import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { PatientsModule } from '../patients/patients.module';
import { SetupModule } from '../setup/setup.module';
import { FrontofficeController } from './frontoffice.controller';
import { FrontofficeRepository } from './frontoffice.repository';
import { FrontofficeService } from './frontoffice.service';

/**
 * Front Office: appointments, walk-ins, OPD token queue, check-in, TV display, duplicate search,
 * patient merge, ABHA capture. Other modules import FrontofficeModule and use FrontofficeService
 * (book, getQueue). Contracts and permissions: packages/shared/src/modules/frontoffice.ts.
 */
@Module({
  imports: [PatientsModule, SetupModule, BillingModule],
  controllers: [FrontofficeController],
  providers: [FrontofficeService, FrontofficeRepository],
  exports: [FrontofficeService],
})
export class FrontofficeModule {}
