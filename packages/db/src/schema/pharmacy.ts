/**
 * Pharmacy tables. Owned by the "pharmacy" workstream (Postgres schema: inventory).
 * Stock tables (items, stores, batches, stock balances and ledger) belong to pharmacy; other modules move stock
 * through PharmacyService. Quantities are whole units of the item's sale unit. SQL: migrations/*_pharmacy_*.sql.
 */
import { sql } from 'drizzle-orm';
import { boolean, date, foreignKey, index, integer, numeric, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { actorColumns, idColumn, inventory as pg, tenantIdColumn, timestamps } from './_common';
import { facilities, patients } from './core';

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const rate = (name: string) => numeric(name, { precision: 5, scale: 2 });
const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow();

export const pharmacyItems = pg.table(
  'items',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    genericName: text('generic_name'),
    form: text('form').notNull().default('tablet'),
    strength: text('strength'),
    manufacturer: text('manufacturer'),
    hsnCode: text('hsn_code'),
    gstRate: rate('gst_rate').notNull().default('5'),
    unit: text('unit').notNull().default('unit'),
    packSize: integer('pack_size').notNull().default(1),
    schedule: text('schedule').notNull().default('otc'),
    reorderLevel: integer('reorder_level').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('items_code_uq').on(t.tenantId, sql`upper(${t.code})`)],
);

export const pharmacyStores = pg.table(
  'stores',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    facilityId: uuid('facility_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull().default('pharmacy'),
    isActive: boolean('is_active').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.facilityId], foreignColumns: [facilities.tenantId, facilities.id] }),
    uniqueIndex('stores_code_uq').on(t.tenantId, sql`upper(${t.code})`),
  ],
);

export const pharmacyBatches = pg.table(
  'batches',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    itemId: uuid('item_id').notNull(),
    batchNo: text('batch_no').notNull(),
    expiryDate: date('expiry_date', { mode: 'string' }).notNull(),
    mrp: money('mrp').notNull(),
    purchaseRate: money('purchase_rate').notNull().default('0'),
    saleRate: money('sale_rate').notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.itemId], foreignColumns: [pharmacyItems.tenantId, pharmacyItems.id] }),
  ],
);

export const pharmacyStockBalances = pg.table(
  'stock_balances',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    storeId: uuid('store_id').notNull(),
    itemId: uuid('item_id').notNull(),
    batchId: uuid('batch_id').notNull(),
    qty: integer('qty').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('stock_balances_store_batch_uq').on(t.tenantId, t.storeId, t.batchId),
    index('stock_balances_item_idx').on(t.tenantId, t.storeId, t.itemId),
  ],
);

/** Append-only: UPDATE/DELETE are revoked from the API role and blocked by a trigger. */
export const pharmacyStockLedger = pg.table(
  'stock_ledger',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    storeId: uuid('store_id').notNull(),
    itemId: uuid('item_id').notNull(),
    batchId: uuid('batch_id').notNull(),
    txnType: text('txn_type').notNull(),
    qtyChange: integer('qty_change').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    note: text('note'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index('stock_ledger_item_idx').on(t.tenantId, t.itemId, t.createdAt)],
);

export const pharmacyGrns = pg.table(
  'pharmacy_grns',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    number: text('number').notNull(),
    storeId: uuid('store_id').notNull(),
    supplierName: text('supplier_name').notNull(),
    supplierGstin: text('supplier_gstin'),
    invoiceNo: text('invoice_no'),
    invoiceDate: date('invoice_date', { mode: 'string' }),
    status: text('status').notNull().default('posted'),
    totalAmount: money('total_amount').notNull().default('0'),
    notes: text('notes'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('pharmacy_grns_number_uq').on(t.tenantId, t.number)],
);

export const pharmacyGrnLines = pg.table(
  'pharmacy_grn_lines',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    grnId: uuid('grn_id').notNull(),
    itemId: uuid('item_id').notNull(),
    batchId: uuid('batch_id').notNull(),
    qty: integer('qty').notNull(),
    freeQty: integer('free_qty').notNull().default(0),
    purchaseRate: money('purchase_rate').notNull(),
    mrp: money('mrp').notNull(),
    gstRate: rate('gst_rate').notNull(),
    amount: money('amount').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.grnId], foreignColumns: [pharmacyGrns.tenantId, pharmacyGrns.id] }).onDelete('cascade'),
  ],
);

export const pharmacyPrescriptions = pg.table(
  'pharmacy_prescriptions',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    /** EMR prescription id; null for paper prescriptions typed in at the counter. */
    prescriptionId: uuid('prescription_id'),
    source: text('source').notNull().default('emr'),
    patientId: uuid('patient_id').notNull(),
    doctorId: uuid('doctor_id'),
    doctorName: text('doctor_name'),
    facilityId: uuid('facility_id'),
    status: text('status').notNull().default('pending'),
    notes: text('notes'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }),
    index('pharmacy_prescriptions_status_idx').on(t.tenantId, t.status, t.createdAt),
  ],
);

export const pharmacyPrescriptionLines = pg.table(
  'pharmacy_prescription_lines',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    pharmacyPrescriptionId: uuid('pharmacy_prescription_id').notNull(),
    lineNo: integer('line_no').notNull(),
    drugName: text('drug_name').notNull(),
    itemCode: text('item_code'),
    itemId: uuid('item_id'),
    dose: text('dose'),
    frequency: text('frequency'),
    days: integer('days'),
    qty: integer('qty').notNull(),
    dispensedQty: integer('dispensed_qty').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.pharmacyPrescriptionId],
      foreignColumns: [pharmacyPrescriptions.tenantId, pharmacyPrescriptions.id],
    }).onDelete('cascade'),
  ],
);

export const pharmacySales = pg.table(
  'pharmacy_sales',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    number: text('number').notNull(),
    type: text('type').notNull(),
    facilityId: uuid('facility_id').notNull(),
    storeId: uuid('store_id').notNull(),
    patientId: uuid('patient_id'),
    customerName: text('customer_name'),
    customerMobile: text('customer_mobile'),
    pharmacyPrescriptionId: uuid('pharmacy_prescription_id'),
    status: text('status').notNull().default('completed'),
    subtotal: money('subtotal').notNull(),
    discount: money('discount').notNull().default('0'),
    taxableAmount: money('taxable_amount').notNull(),
    taxAmount: money('tax_amount').notNull(),
    total: money('total').notNull(),
    returnedAmount: money('returned_amount').notNull().default('0'),
    paymentMode: text('payment_mode'),
    invoiceId: uuid('invoice_id'),
    invoiceNumber: text('invoice_number'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('pharmacy_sales_number_uq').on(t.tenantId, t.number),
    index('pharmacy_sales_created_idx').on(t.tenantId, t.createdAt),
  ],
);

export const pharmacySaleLines = pg.table(
  'pharmacy_sale_lines',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    saleId: uuid('sale_id').notNull(),
    itemId: uuid('item_id').notNull(),
    batchId: uuid('batch_id').notNull(),
    pharmacyPrescriptionLineId: uuid('pharmacy_prescription_line_id'),
    qty: integer('qty').notNull(),
    returnedQty: integer('returned_qty').notNull().default(0),
    unitPrice: money('unit_price').notNull(),
    discountPct: rate('discount_pct').notNull().default('0'),
    gstRate: rate('gst_rate').notNull(),
    taxableAmount: money('taxable_amount').notNull(),
    taxAmount: money('tax_amount').notNull(),
    amount: money('amount').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.saleId], foreignColumns: [pharmacySales.tenantId, pharmacySales.id] }),
    index('pharmacy_sale_lines_sale_idx').on(t.tenantId, t.saleId),
  ],
);

export const pharmacySaleReturns = pg.table(
  'pharmacy_sale_returns',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    number: text('number').notNull(),
    saleId: uuid('sale_id').notNull(),
    refundAmount: money('refund_amount').notNull(),
    refundMode: text('refund_mode'),
    reason: text('reason'),
    /** Billing credit note / refund receipt for returns on an invoiced sale. */
    creditNoteId: uuid('credit_note_id'),
    creditNoteNumber: text('credit_note_number'),
    billingRefundNumber: text('billing_refund_number'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('pharmacy_sale_returns_number_uq').on(t.tenantId, t.number)],
);

export const pharmacySaleReturnLines = pg.table(
  'pharmacy_sale_return_lines',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    returnId: uuid('return_id').notNull(),
    saleLineId: uuid('sale_line_id').notNull(),
    qty: integer('qty').notNull(),
    amount: money('amount').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);
