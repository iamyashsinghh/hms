import { Injectable } from '@nestjs/common';
import { pharmacy, type ImportResult } from '@hms/shared';
import type { z } from 'zod';
import { DbService } from '../../common/db/db.service';
import { currentContext } from '../../common/context/request-context';
import { forbidden } from '../../common/errors/errors';
import { runImport } from '../../common/imports/bulk-import';
import { PharmacyCatalogService } from './catalog.service';
import { PharmacyStockService } from './stock.service';

type Row = pharmacy.ItemImportRow;
const hasStock = (r: Row) => r.batchNo !== undefined;

/** Drug master import from Excel / CSV; rows with a batch also load opening stock into the chosen store. */
@Injectable()
export class PharmacyImportService {
  constructor(
    private readonly db: DbService,
    private readonly catalog: PharmacyCatalogService,
    private readonly stock: PharmacyStockService,
  ) {}

  async importItems(input: z.output<typeof pharmacy.itemImportSchema>): Promise<ImportResult> {
    const ctx = currentContext()!;
    let storeError: string | null = null;
    return runImport<Row>(
      {
        columns: pharmacy.ITEM_IMPORT_COLUMNS,
        schema: pharmacy.itemImportRowSchema,
        key: (r) => r.code.toUpperCase(),
        label: (r) => r.name,
        existing: (codes) => this.catalog.itemIdsByCode(codes),
        prepare: async (rows) => {
          if (!rows.some(hasStock)) return;
          if (!input.storeId) storeError = 'Choose a store to load opening stock into';
          else if (!ctx.permissions.has('pharmacy.stock.receive')) storeError = 'You may not enter opening stock';
          else {
            try {
              await this.db.tx((tx) => this.stock.storeForWrite(tx, input.storeId!));
            } catch (e) {
              storeError = e instanceof Error ? e.message : 'Store not available';
            }
          }
        },
        check: (r) => (hasStock(r) && storeError ? [{ column: 'Batch no', message: storeError }] : []),
        create: (r) => this.save(r, input.storeId),
        update: (id, given, r) => this.save(r, input.storeId, { id, given }),
      },
      input,
    );
  }

  private save(r: Row, storeId: string | undefined, existing?: { id: string; given: Partial<Row> }) {
    const { batchNo, expiryDate, mrp, purchaseRate, saleRate, qty } = r;
    return this.db.tx(async (tx) => {
      const item = existing ? await this.catalog.updateItem(existing.id, existing.given, tx) : await this.catalog.createItem(r, tx);
      if (batchNo === undefined || !storeId) return item;
      if (!currentContext()?.permissions.has('pharmacy.stock.receive')) throw forbidden();
      const store = await this.stock.storeForWrite(tx, storeId);
      const batch = await this.stock.ensureBatch(tx, { itemId: item.id, batchNo, expiryDate: expiryDate!, mrp: mrp!, purchaseRate: purchaseRate ?? 0, saleRate });
      await this.stock.stockIn(tx, { storeId: store.id, itemId: item.id, batchId: batch.id, qty: qty!, txnType: 'opening', note: 'Opening stock (import)' });
      return item;
    });
  }
}
