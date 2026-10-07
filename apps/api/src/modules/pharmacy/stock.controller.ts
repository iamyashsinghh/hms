import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { paginationQuerySchema, pharmacy, type Paginated } from '@hms/shared';
import type { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { PharmacyStockService } from './stock.service';

@Controller('pharmacy')
export class PharmacyStockController {
  constructor(private readonly stock: PharmacyStockService) {}

  @Get('stock')
  @RequirePermissions('pharmacy.stock.read')
  list(@Query(new ZodPipe(pharmacy.stockQuerySchema)) q: z.output<typeof pharmacy.stockQuerySchema>): Promise<Paginated<pharmacy.StockRow>> {
    return this.stock.stock(q);
  }

  @Get('stock/expiring')
  @RequirePermissions('pharmacy.stock.read')
  expiring(@Query(new ZodPipe(pharmacy.expiringQuerySchema)) q: z.output<typeof pharmacy.expiringQuerySchema>): Promise<pharmacy.ExpiringBatch[]> {
    return this.stock.expiring(q);
  }

  @Get('stock/ledger')
  @RequirePermissions('pharmacy.stock.read')
  ledger(@Query(new ZodPipe(pharmacy.ledgerQuerySchema)) q: z.output<typeof pharmacy.ledgerQuerySchema>): Promise<Paginated<pharmacy.LedgerEntry>> {
    return this.stock.ledgerEntries(q);
  }

  @Get('stores/:storeId/items/:itemId/batches')
  @RequirePermissions('pharmacy.stock.read')
  batches(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('itemId', ParseUUIDPipe) itemId: string): Promise<pharmacy.BatchStock[]> {
    return this.stock.batches(storeId, itemId);
  }

  @Post('stock/opening')
  @RequirePermissions('pharmacy.stock.receive')
  opening(@Body(new ZodPipe(pharmacy.openingStockSchema)) body: z.output<typeof pharmacy.openingStockSchema>) {
    return this.stock.openingStock(body);
  }

  @Post('stock/adjustments')
  @RequirePermissions('pharmacy.stock.adjust')
  adjust(@Body(new ZodPipe(pharmacy.stockAdjustmentSchema)) body: z.output<typeof pharmacy.stockAdjustmentSchema>) {
    return this.stock.adjust(body);
  }

  @Get('grns')
  @RequirePermissions('pharmacy.stock.read')
  listGrns(@Query(new ZodPipe(paginationQuerySchema)) q: z.output<typeof paginationQuerySchema>): Promise<Paginated<pharmacy.Grn>> {
    return this.stock.listGrns(q.page, q.pageSize);
  }

  @Get('grns/:id')
  @RequirePermissions('pharmacy.stock.read')
  getGrn(@Param('id', ParseUUIDPipe) id: string): Promise<pharmacy.Grn> {
    return this.stock.getGrn(id);
  }

  @Post('grns')
  @RequirePermissions('pharmacy.stock.receive')
  createGrn(@Body(new ZodPipe(pharmacy.createGrnSchema)) body: z.output<typeof pharmacy.createGrnSchema>): Promise<pharmacy.Grn> {
    return this.stock.createGrn(body);
  }
}
