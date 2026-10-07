import { Module, OnModuleInit } from '@nestjs/common';
import type { pharmacy } from '@hms/shared';
import { EventBus } from '../../common/events/event-bus';
import { PharmacyBillingGateway } from './billing.gateway';
import { PharmacyCatalogController } from './catalog.controller';
import { PharmacyCatalogService } from './catalog.service';
import { PharmacyPrescriptionsService } from './prescriptions.service';
import { PharmacySalesController } from './sales.controller';
import { PharmacySalesService } from './sales.service';
import { PharmacyService } from './pharmacy.service';
import { PharmacyStockController } from './stock.controller';
import { PharmacyStockService } from './stock.service';

/**
 * Pharmacy: item master, stores, batches + append-only stock ledger, GRN, Rx dispense queue, OTC sales, returns.
 * Other modules import PharmacyModule and use PharmacyService. Owned by the "pharmacy" workstream.
 */
@Module({
  controllers: [PharmacyCatalogController, PharmacyStockController, PharmacySalesController],
  providers: [
    PharmacyCatalogService,
    PharmacyStockService,
    PharmacySalesService,
    PharmacyPrescriptionsService,
    PharmacyBillingGateway,
    PharmacyService,
  ],
  exports: [PharmacyService],
})
export class PharmacyModule implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly prescriptions: PharmacyPrescriptionsService,
  ) {}

  onModuleInit() {
    this.bus.on<pharmacy.EmrPrescriptionCreatedEvent>('emr.prescription.created', (e) => this.prescriptions.ingestFromEmr(e));
  }
}
