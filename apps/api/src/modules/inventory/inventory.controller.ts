import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { importRequestSchema, inventory, type ImportResult, type Paginated } from '@hms/shared';
import type { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { RequireEntitlement } from '../platform';
import { InventoryIndentsService } from './indents.service';
import { InventoryPurchaseService } from './purchase.service';
import { InventoryVendorsService } from './vendors.service';

type Out<T extends z.ZodType> = z.output<T>;
const id = new ParseUUIDPipe();

@Controller('inventory/vendors')
@RequireEntitlement('inventory')
export class InventoryVendorsController {
  constructor(private readonly vendors: InventoryVendorsService) {}

  @Get()
  @RequirePermissions('inventory.vendor.read')
  list(@Query(new ZodPipe(inventory.vendorQuerySchema)) q: Out<typeof inventory.vendorQuerySchema>): Promise<Paginated<inventory.Vendor>> {
    return this.vendors.list(q);
  }

  @Get(':id')
  @RequirePermissions('inventory.vendor.read')
  get(@Param('id', id) vendorId: string): Promise<inventory.Vendor> {
    return this.vendors.get(vendorId);
  }

  @Post()
  @RequirePermissions('inventory.vendor.manage')
  create(@Body(new ZodPipe(inventory.createVendorSchema)) body: Out<typeof inventory.createVendorSchema>): Promise<inventory.Vendor> {
    return this.vendors.create(body);
  }

  /** Bulk import from Excel / CSV. `dryRun` validates only (the preview). */
  @Post('import')
  @HttpCode(200)
  @RequirePermissions('inventory.vendor.manage')
  importVendors(@Body(new ZodPipe(importRequestSchema)) body: Out<typeof importRequestSchema>): Promise<ImportResult> {
    return this.vendors.import(body);
  }

  @Patch(':id')
  @RequirePermissions('inventory.vendor.manage')
  update(@Param('id', id) vendorId: string, @Body(new ZodPipe(inventory.updateVendorSchema)) body: Out<typeof inventory.updateVendorSchema>): Promise<inventory.Vendor> {
    return this.vendors.update(vendorId, body);
  }
}

@Controller('inventory/requisitions')
@RequireEntitlement('inventory')
export class InventoryRequisitionsController {
  constructor(private readonly purchase: InventoryPurchaseService) {}

  @Get()
  @RequirePermissions('inventory.purchase.read')
  list(@Query(new ZodPipe(inventory.requisitionQuerySchema)) q: Out<typeof inventory.requisitionQuerySchema>): Promise<Paginated<inventory.Requisition>> {
    return this.purchase.listRequisitions(q);
  }

  @Get(':id')
  @RequirePermissions('inventory.purchase.read')
  get(@Param('id', id) reqId: string): Promise<inventory.Requisition> {
    return this.purchase.getRequisition(reqId);
  }

  @Post()
  @RequirePermissions('inventory.purchase.request')
  create(@Body(new ZodPipe(inventory.createRequisitionSchema)) body: Out<typeof inventory.createRequisitionSchema>): Promise<inventory.Requisition> {
    return this.purchase.createRequisition(body);
  }

  @Patch(':id')
  @RequirePermissions('inventory.purchase.request')
  update(@Param('id', id) reqId: string, @Body(new ZodPipe(inventory.updateRequisitionSchema)) body: Out<typeof inventory.updateRequisitionSchema>): Promise<inventory.Requisition> {
    return this.purchase.updateRequisition(reqId, body);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @RequirePermissions('inventory.purchase.approve')
  decide(@Param('id', id) reqId: string, @Body(new ZodPipe(inventory.decisionSchema)) body: Out<typeof inventory.decisionSchema>): Promise<inventory.Requisition> {
    return this.purchase.decideRequisition(reqId, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('inventory.purchase.request')
  cancel(@Param('id', id) reqId: string): Promise<inventory.Requisition> {
    return this.purchase.cancelRequisition(reqId);
  }
}

@Controller('inventory/purchase-orders')
@RequireEntitlement('inventory')
export class InventoryPurchaseOrdersController {
  constructor(private readonly purchase: InventoryPurchaseService) {}

  @Get()
  @RequirePermissions('inventory.purchase.read')
  list(@Query(new ZodPipe(inventory.purchaseOrderQuerySchema)) q: Out<typeof inventory.purchaseOrderQuerySchema>): Promise<Paginated<inventory.PurchaseOrder>> {
    return this.purchase.listPurchaseOrders(q);
  }

  @Get(':id')
  @RequirePermissions('inventory.purchase.read')
  get(@Param('id', id) poId: string): Promise<inventory.PurchaseOrder> {
    return this.purchase.getPurchaseOrder(poId);
  }

  @Post()
  @RequirePermissions('inventory.purchase.order')
  create(@Body(new ZodPipe(inventory.createPurchaseOrderSchema)) body: Out<typeof inventory.createPurchaseOrderSchema>): Promise<inventory.PurchaseOrder> {
    return this.purchase.createPurchaseOrder(body);
  }

  @Patch(':id')
  @RequirePermissions('inventory.purchase.order')
  update(@Param('id', id) poId: string, @Body(new ZodPipe(inventory.updatePurchaseOrderSchema)) body: Out<typeof inventory.updatePurchaseOrderSchema>): Promise<inventory.PurchaseOrder> {
    return this.purchase.updatePurchaseOrder(poId, body);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions('inventory.purchase.approve')
  approve(@Param('id', id) poId: string): Promise<inventory.PurchaseOrder> {
    return this.purchase.approvePurchaseOrder(poId);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('inventory.purchase.approve')
  cancel(@Param('id', id) poId: string, @Body(new ZodPipe(inventory.closePurchaseOrderSchema)) body: Out<typeof inventory.closePurchaseOrderSchema>): Promise<inventory.PurchaseOrder> {
    return this.purchase.cancelPurchaseOrder(poId, body);
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermissions('inventory.purchase.approve')
  close(@Param('id', id) poId: string, @Body(new ZodPipe(inventory.closePurchaseOrderSchema)) body: Out<typeof inventory.closePurchaseOrderSchema>): Promise<inventory.PurchaseOrder> {
    return this.purchase.closePurchaseOrder(poId, body);
  }
}

@Controller('inventory/grns')
@RequireEntitlement('inventory')
export class InventoryGrnsController {
  constructor(private readonly purchase: InventoryPurchaseService) {}

  @Get()
  @RequirePermissions('inventory.purchase.read')
  list(@Query(new ZodPipe(inventory.grnQuerySchema)) q: Out<typeof inventory.grnQuerySchema>): Promise<Paginated<inventory.Grn>> {
    return this.purchase.listGrns(q);
  }

  @Get(':id')
  @RequirePermissions('inventory.purchase.read')
  get(@Param('id', id) grnId: string): Promise<inventory.Grn> {
    return this.purchase.getGrn(grnId);
  }

  @Post()
  @RequirePermissions('inventory.grn.create')
  create(@Body(new ZodPipe(inventory.createGrnSchema)) body: Out<typeof inventory.createGrnSchema>): Promise<inventory.Grn> {
    return this.purchase.createGrn(body);
  }

  @Post(':id/returns')
  @RequirePermissions('inventory.grn.create')
  createReturn(@Param('id', id) grnId: string, @Body(new ZodPipe(inventory.createPurchaseReturnSchema)) body: Out<typeof inventory.createPurchaseReturnSchema>): Promise<inventory.PurchaseReturn> {
    return this.purchase.createReturn(grnId, body);
  }
}

@Controller('inventory/indents')
@RequireEntitlement('inventory')
export class InventoryIndentsController {
  constructor(private readonly indents: InventoryIndentsService) {}

  @Get()
  @RequirePermissions('inventory.indent.read')
  list(@Query(new ZodPipe(inventory.indentQuerySchema)) q: Out<typeof inventory.indentQuerySchema>): Promise<Paginated<inventory.Indent>> {
    return this.indents.list(q);
  }

  @Get(':id')
  @RequirePermissions('inventory.indent.read')
  get(@Param('id', id) indentId: string): Promise<inventory.Indent> {
    return this.indents.get(indentId);
  }

  @Post()
  @RequirePermissions('inventory.indent.create')
  create(@Body(new ZodPipe(inventory.createIndentSchema)) body: Out<typeof inventory.createIndentSchema>): Promise<inventory.Indent> {
    return this.indents.create(body);
  }

  @Patch(':id')
  @RequirePermissions('inventory.indent.create')
  update(@Param('id', id) indentId: string, @Body(new ZodPipe(inventory.updateIndentSchema)) body: Out<typeof inventory.updateIndentSchema>): Promise<inventory.Indent> {
    return this.indents.update(indentId, body);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @RequirePermissions('inventory.indent.approve')
  decide(@Param('id', id) indentId: string, @Body(new ZodPipe(inventory.decideIndentSchema)) body: Out<typeof inventory.decideIndentSchema>): Promise<inventory.Indent> {
    return this.indents.decide(indentId, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('inventory.indent.create')
  cancel(@Param('id', id) indentId: string): Promise<inventory.Indent> {
    return this.indents.cancel(indentId);
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermissions('inventory.indent.approve')
  close(@Param('id', id) indentId: string, @Body(new ZodPipe(inventory.closeIndentSchema)) body: Out<typeof inventory.closeIndentSchema>): Promise<inventory.Indent> {
    return this.indents.close(indentId, body);
  }

  @Post(':id/issue')
  @RequirePermissions('inventory.indent.issue')
  issue(@Param('id', id) indentId: string, @Body(new ZodPipe(inventory.issueIndentSchema)) body: Out<typeof inventory.issueIndentSchema>): Promise<inventory.Indent> {
    return this.indents.issue(indentId, body);
  }
}
