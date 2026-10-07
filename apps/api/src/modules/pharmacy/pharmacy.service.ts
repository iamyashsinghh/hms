import { Injectable } from '@nestjs/common';
import type { Tx } from '@hms/db';
import type { pharmacy } from '@hms/shared';
import { PharmacyCatalogService } from './catalog.service';
import { PharmacyStockService, type Allocation, type IncomingBatch } from './stock.service';

type MovementType = 'grn' | 'purchase_return' | 'transfer_in' | 'transfer_out' | 'adjustment' | 'dispense';

/**
 * What other modules may use (import PharmacyModule). Wave 2 inventory posts PO-based GRNs, transfers and
 * purchase returns here; IPD issues ward medication here. All methods run inside the caller's transaction.
 */
@Injectable()
export class PharmacyService {
  constructor(
    private readonly catalog: PharmacyCatalogService,
    private readonly stock: PharmacyStockService,
  ) {}

  getItem(id: string): Promise<pharmacy.Item> {
    return this.catalog.getItem(id);
  }

  /** A pharmacy/inventory store: {id, facilityId, code, name, type, isActive}. 404 if not in this tenant. */
  getStore(id: string, tx?: Tx): Promise<pharmacy.Store> {
    return this.catalog.getStore(id, tx);
  }

  /** Adds units of a batch (created if new) to a store and writes the ledger. Returns the new batch balance. */
  async receive(tx: Tx, input: IncomingBatch & { storeId: string; qty: number; txnType: Extract<MovementType, 'grn' | 'transfer_in' | 'adjustment'>; refType?: string; refId?: string; note?: string }) {
    await this.stock.storeForWrite(tx, input.storeId);
    const batch = await this.stock.ensureBatch(tx, input);
    const balance = await this.stock.stockIn(tx, { ...input, batchId: batch.id });
    return { batchId: batch.id, balance };
  }

  /** Removes units FEFO (or from one batch) and writes the ledger. Fails with 409 insufficient_stock. */
  async issue(
    tx: Tx,
    input: { storeId: string; itemId: string; qty: number; batchId?: string; txnType: Exclude<MovementType, 'grn' | 'transfer_in'>; refType?: string; refId?: string; note?: string },
  ): Promise<Allocation[]> {
    await this.stock.storeForWrite(tx, input.storeId);
    const allocations = await this.stock.allocate(tx, input.storeId, input.itemId, input.qty, input.batchId);
    for (const a of allocations) await this.stock.stockOut(tx, { ...input, batchId: a.batch.id, qty: a.qty });
    await this.stock.checkLow(tx, input.storeId, input.itemId, input.qty);
    return allocations;
  }
}
