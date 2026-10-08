import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { IpdModule } from '../ipd/ipd.module';
import { PharmacyModule } from '../pharmacy/pharmacy.module';
import {
  InventoryGrnsController,
  InventoryIndentsController,
  InventoryPurchaseOrdersController,
  InventoryRequisitionsController,
  InventoryVendorsController,
} from './inventory.controller';
import { InventoryIndentsService } from './indents.service';
import { InventoryPatientGateway } from './patient.gateway';
import { InventoryPurchaseService } from './purchase.service';
import { InventoryStockGateway } from './stock.gateway';
import { InventoryVendorsService } from './vendors.service';

/**
 * Inventory & Procurement: vendors, purchase requisitions, purchase orders, GRN against a PO, purchase returns,
 * department indents and store-to-store issues. Items, stores and stock are pharmacy's; every stock movement goes
 * through PharmacyService. An issue can be for a patient: consumables are then charged to the patient account
 * (billing rule `consumables`). Owned by the "inventory" workstream (see PARALLEL_PLAN.md).
 */
@Module({
  imports: [PharmacyModule, BillingModule, IpdModule],
  controllers: [
    InventoryVendorsController,
    InventoryRequisitionsController,
    InventoryPurchaseOrdersController,
    InventoryGrnsController,
    InventoryIndentsController,
  ],
  providers: [InventoryVendorsService, InventoryPurchaseService, InventoryIndentsService, InventoryStockGateway, InventoryPatientGateway],
  exports: [InventoryPurchaseService, InventoryIndentsService],
})
export class InventoryModule {}
