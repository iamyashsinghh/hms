import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { PatientsModule } from '../patients/patients.module';
import { InsuranceController } from './insurance.controller';
import { InsuranceRepository } from './insurance.repository';
import { InsuranceService } from './insurance.service';

/**
 * Insurance & Schemes: payers (insurers, TPAs, corporates, PM-JAY/CGHS-style schemes) and their packages,
 * patient policies, pre-authorisation, claims with documents, settlements posted to billing.
 * Other modules import InsuranceModule and call InsuranceService.getInvoiceSplit(invoiceId).
 * Payer price lists are billing price lists with payerId = an insurance payer id.
 */
@Module({
  imports: [BillingModule, PatientsModule],
  controllers: [InsuranceController],
  providers: [InsuranceService, InsuranceRepository],
  exports: [InsuranceService],
})
export class InsuranceModule {}
