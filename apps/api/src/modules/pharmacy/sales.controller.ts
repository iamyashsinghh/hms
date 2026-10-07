import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { pharmacy, type Paginated } from '@hms/shared';
import type { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { RequireEntitlement } from '../platform';
import { PharmacySalesService } from './sales.service';
import { PharmacyPrescriptionsService } from './prescriptions.service';

@Controller('pharmacy')
@RequireEntitlement('pharmacy')
export class PharmacySalesController {
  constructor(
    private readonly sales: PharmacySalesService,
    private readonly prescriptions: PharmacyPrescriptionsService,
  ) {}

  @Get('sales')
  @RequirePermissions('pharmacy.sale.read')
  list(@Query(new ZodPipe(pharmacy.saleListQuerySchema)) q: z.output<typeof pharmacy.saleListQuerySchema>): Promise<Paginated<pharmacy.Sale>> {
    return this.sales.listSales(q);
  }

  @Get('sales/:id')
  @RequirePermissions('pharmacy.sale.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.getSale(id);
  }

  @Post('sales')
  @RequirePermissions('pharmacy.sale.create')
  create(@Body(new ZodPipe(pharmacy.createSaleSchema)) body: z.output<typeof pharmacy.createSaleSchema>): Promise<pharmacy.Sale> {
    return this.sales.createSale(body);
  }

  @Post('sales/:id/returns')
  @RequirePermissions('pharmacy.sale.return')
  createReturn(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(pharmacy.createSaleReturnSchema)) body: z.output<typeof pharmacy.createSaleReturnSchema>): Promise<pharmacy.SaleReturn> {
    return this.sales.createReturn(id, body);
  }

  @Get('prescriptions')
  @RequirePermissions('pharmacy.prescription.read')
  queue(@Query(new ZodPipe(pharmacy.prescriptionQuerySchema)) q: z.output<typeof pharmacy.prescriptionQuerySchema>): Promise<Paginated<pharmacy.Prescription>> {
    return this.prescriptions.list(q);
  }

  @Get('prescriptions/:id')
  @RequirePermissions('pharmacy.prescription.read')
  getPrescription(@Param('id', ParseUUIDPipe) id: string): Promise<pharmacy.Prescription> {
    return this.prescriptions.get(id);
  }

  @Post('prescriptions')
  @RequirePermissions('pharmacy.prescription.create')
  createPrescription(@Body(new ZodPipe(pharmacy.createPrescriptionSchema)) body: z.output<typeof pharmacy.createPrescriptionSchema>): Promise<pharmacy.Prescription> {
    return this.prescriptions.create(body);
  }

  @Post('prescriptions/:id/cancel')
  @RequirePermissions('pharmacy.prescription.dispense')
  cancelPrescription(@Param('id', ParseUUIDPipe) id: string): Promise<pharmacy.Prescription> {
    return this.prescriptions.cancel(id);
  }

  @Post('prescriptions/:id/dispense')
  @RequirePermissions('pharmacy.prescription.dispense')
  dispense(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(pharmacy.dispenseSchema)) body: z.output<typeof pharmacy.dispenseSchema>): Promise<pharmacy.Sale> {
    return this.sales.dispense(id, body);
  }
}
