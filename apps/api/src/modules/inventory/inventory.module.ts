import { Module } from '@nestjs/common';
import { PharmacyModule } from '../pharmacy/pharmacy.module';
import {
  InventoryGrnsController,
  InventoryIndentsController,
  InventoryPurchaseOrdersController,
  InventoryRequisitionsController,
  InventoryVendorsController,
} from './inventory.controller';
import { InventoryIndentsService } from './indents.service';
import { InventoryPurchaseService } from './purchase.service';
import { InventoryStockGateway } from './stock.gateway';
import { InventoryVendorsService } from './vendors.service';

/**
 * Inventory & Procurement: vendors, purchase requisitions, purchase orders, GRN against a PO, purchase returns,
 * department indents and store-to-store issues. Items, stores and stock are pharmacy's; every stock movement goes
 * through PharmacyService. Owned by the "inventory" workstream (see PARALLEL_PLAN.md).
 */
@Module({
  imports: [PharmacyModule],
  controllers: [
    InventoryVendorsController,
    InventoryRequisitionsController,
    InventoryPurchaseOrdersController,
    InventoryGrnsController,
    InventoryIndentsController,
  ],
  providers: [InventoryVendorsService, InventoryPurchaseService, InventoryIndentsService, InventoryStockGateway],
  exports: [InventoryPurchaseService, InventoryIndentsService],
})
export class InventoryModule {}
