import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { pharmacy, type Paginated } from '@hms/shared';
import type { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { RequireEntitlement } from '../platform';
import { PharmacyCatalogService } from './catalog.service';

@Controller('pharmacy')
@RequireEntitlement('pharmacy')
export class PharmacyCatalogController {
  constructor(private readonly catalog: PharmacyCatalogService) {}

  @Get('items')
  @RequirePermissions('pharmacy.item.read')
  searchItems(@Query(new ZodPipe(pharmacy.itemSearchQuerySchema)) q: z.output<typeof pharmacy.itemSearchQuerySchema>): Promise<Paginated<pharmacy.Item>> {
    return this.catalog.searchItems(q);
  }

  @Get('items/:id')
  @RequirePermissions('pharmacy.item.read')
  getItem(@Param('id', ParseUUIDPipe) id: string): Promise<pharmacy.Item> {
    return this.catalog.getItem(id);
  }

  @Post('items')
  @RequirePermissions('pharmacy.item.manage')
  createItem(@Body(new ZodPipe(pharmacy.createItemSchema)) body: z.output<typeof pharmacy.createItemSchema>): Promise<pharmacy.Item> {
    return this.catalog.createItem(body);
  }

  @Patch('items/:id')
  @RequirePermissions('pharmacy.item.manage')
  updateItem(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(pharmacy.updateItemSchema)) body: z.output<typeof pharmacy.updateItemSchema>): Promise<pharmacy.Item> {
    return this.catalog.updateItem(id, body);
  }

  @Get('stores')
  @RequirePermissions('pharmacy.stock.read')
  listStores(): Promise<pharmacy.Store[]> {
    return this.catalog.listStores();
  }

  @Post('stores')
  @RequirePermissions('pharmacy.store.manage')
  createStore(@Body(new ZodPipe(pharmacy.createStoreSchema)) body: z.output<typeof pharmacy.createStoreSchema>): Promise<pharmacy.Store> {
    return this.catalog.createStore(body);
  }

  @Patch('stores/:id')
  @RequirePermissions('pharmacy.store.manage')
  updateStore(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(pharmacy.updateStoreSchema)) body: z.output<typeof pharmacy.updateStoreSchema>): Promise<pharmacy.Store> {
    return this.catalog.updateStore(id, body);
  }
}
