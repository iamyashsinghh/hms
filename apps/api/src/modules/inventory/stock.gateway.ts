import { Injectable } from '@nestjs/common';
import type { Tx } from '@hms/db';
import type { pharmacy } from '@hms/shared';
import { currentContext } from '../../common/context/request-context';
import { badRequest, forbidden } from '../../common/errors/errors';
import { PharmacyService } from '../pharmacy/pharmacy.service';

export interface StoreInfo {
  id: string;
  facilityId: string;
  name: string;
  isActive: boolean;
}

/** Batch-less consumables (gloves, linen, stationery) are received as batch "NA" that never expires. */
export const NO_BATCH = 'NA';
export const NO_EXPIRY = '2099-12-31';

/**
 * Everything inventory needs from pharmacy, which owns items, stores, batches and the stock ledger.
 * Stock only ever moves through PharmacyService so the ledger stays the single source of truth.
 */
@Injectable()
export class InventoryStockGateway {
  constructor(private readonly pharmacy: PharmacyService) {}

  /** Loads items by id (outside any transaction). Fails with 400 for unknown or inactive items. */
  async items(ids: string[]): Promise<Map<string, pharmacy.Item>> {
    const unique = [...new Set(ids)];
    const items = await Promise.all(
      unique.map((id) =>
        this.pharmacy.getItem(id).catch(() => {
          throw badRequest('unknown_item', `Item ${id} does not exist`);
        }),
      ),
    );
    for (const it of items) if (!it.isActive) throw badRequest('item_inactive', `${it.name} is inactive`);
    return new Map(items.map((i) => [i.id, i]));
  }

  /** Store name and facility for documents (404 when not in this hospital). */
  async store(tx: Tx, id: string): Promise<StoreInfo> {
    const { facilityId, name, isActive } = await this.pharmacy.getStore(id, tx);
    return { id, facilityId, name, isActive };
  }

  /** A store the caller may raise documents for: active and in one of the caller's facilities. */
  async storeForUse(tx: Tx, id: string): Promise<StoreInfo> {
    const store = await this.store(tx, id);
    if (!store.isActive) throw badRequest('store_inactive', `Store ${store.name} is inactive`);
    assertFacility(store.facilityId);
    return store;
  }

  receive(tx: Tx, input: Parameters<PharmacyService['receive']>[1]) {
    return this.pharmacy.receive(tx, input);
  }

  issue(tx: Tx, input: Parameters<PharmacyService['issue']>[1]) {
    return this.pharmacy.issue(tx, input);
  }
}

export function assertFacility(facilityId: string): void {
  const ctx = currentContext();
  if (ctx && ctx.facilityIds !== 'all' && !ctx.facilityIds.includes(facilityId)) {
    throw forbidden('You do not work in the facility of this store');
  }
}

/** Facilities the caller may see, or null for all. */
export function visibleFacilities(): string[] | null {
  const ctx = currentContext();
  return !ctx || ctx.facilityIds === 'all' ? null : ctx.facilityIds;
}
