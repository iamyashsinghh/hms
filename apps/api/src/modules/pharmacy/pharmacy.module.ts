import { Module, OnModuleInit } from '@nestjs/common';
import type { billing, pharmacy } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { EventBus } from '../../common/events/event-bus';
import { BillingModule } from '../billing/billing.module';
import { IpdModule } from '../ipd/ipd.module';
import { PharmacyBillingGateway } from './billing.gateway';
import { PharmacyCatalogController } from './catalog.controller';
import { PharmacyCatalogService } from './catalog.service';
import { PharmacyImportService } from './import.service';
import { PharmacyPrescriptionsService } from './prescriptions.service';
import { PharmacySalesController } from './sales.controller';
import { PharmacySalesService } from './sales.service';
import { PharmacyService } from './pharmacy.service';
import { PharmacyStockController } from './stock.controller';
import { PharmacyStockService } from './stock.service';

/**
 * Pharmacy: item master, stores, batches + append-only stock ledger, GRN, Rx dispense queue, OTC sales, returns.
 * Medicines for admitted patients go on the IPD bill as charges when the hospital's billing rules say so.
 * Other modules import PharmacyModule and use PharmacyService. Owned by the "pharmacy" workstream.
 */
@Module({
  imports: [BillingModule, IpdModule],
  controllers: [PharmacyCatalogController, PharmacyStockController, PharmacySalesController],
  providers: [
    PharmacyCatalogService,
    PharmacyImportService,
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
    private readonly db: DbService,
    private readonly prescriptions: PharmacyPrescriptionsService,
    private readonly sales: PharmacySalesService,
  ) {}

  onModuleInit() {
    this.bus.on<pharmacy.EmrPrescriptionCreatedEvent>('emr.prescription.created', (e) => this.prescriptions.ingestFromEmr(e));
    // Medicines on the IPD bill get the bill number once their charges are billed.
    this.bus.on<billing.ChargesBilledEvent>('billing.charges.billed', (e) =>
      this.db.asTenant({ tenantId: e.tenantId }, (tx) => this.sales.onChargesBilled(tx, e.payload)),
    );
  }
}
