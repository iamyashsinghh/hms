/**
 * Inventory & Procurement tables. Owned by the "inventory" workstream (Postgres schema: inventory, tables proc_*).
 * Items, stores, batches and stock belong to pharmacy (./pharmacy.ts); stock moves through PharmacyService.
 * SQL: migrations/*_inventory_*.sql.
 */
import { sql } from 'drizzle-orm';
import { boolean, date, foreignKey, index, integer, numeric, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { actorColumns, idColumn, inventory as pg, tenantIdColumn, timestamps } from './_common';
import { facilities } from './core';
import { pharmacyBatches, pharmacyItems, pharmacyStores } from './pharmacy';

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const rate = (name: string) => numeric(name, { precision: 5, scale: 2 });
const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
const createdAt = () => at('created_at').notNull().defaultNow();

export const inventoryVendors = pg.table(
  'proc_vendors',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    contactPerson: text('contact_person'),
    phone: text('phone'),
    email: text('email'),
    gstin: text('gstin'),
    pan: text('pan'),
    address: text('address'),
    paymentTermsDays: integer('payment_terms_days').notNull().default(30),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('proc_vendors_code_uq').on(t.tenantId, sql`upper(${t.code})`)],
);

export const inventoryRequisitions = pg.table(
  'proc_requisitions',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    number: text('number').notNull(),
    facilityId: uuid('facility_id').notNull(),
    storeId: uuid('store_id').notNull(),
    storeName: text('store_name').notNull(),
    status: text('status').notNull().default('submitted'),
    neededBy: date('needed_by', { mode: 'string' }),
    notes: text('notes'),
    decidedBy: uuid('decided_by'),
    decidedAt: at('decided_at'),
    decisionNote: text('decision_note'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.facilityId], foreignColumns: [facilities.tenantId, facilities.id] }),
    foreignKey({ columns: [t.tenantId, t.storeId], foreignColumns: [pharmacyStores.tenantId, pharmacyStores.id] }),
    uniqueIndex('proc_requisitions_number_uq').on(t.tenantId, t.number),
    index('proc_requisitions_status_idx').on(t.tenantId, t.status, t.createdAt),
  ],
);

export const inventoryRequisitionLines = pg.table(
  'proc_requisition_lines',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    requisitionId: uuid('requisition_id').notNull(),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id').notNull(),
    itemCode: text('item_code').notNull(),
    itemName: text('item_name').notNull(),
    unit: text('unit').notNull(),
    qty: integer('qty').notNull(),
    note: text('note'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.requisitionId], foreignColumns: [inventoryRequisitions.tenantId, inventoryRequisitions.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.itemId], foreignColumns: [pharmacyItems.tenantId, pharmacyItems.id] }),
    index('proc_requisition_lines_req_idx').on(t.tenantId, t.requisitionId),
  ],
);

export const inventoryPurchaseOrders = pg.table(
  'proc_purchase_orders',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    number: text('number').notNull(),
    facilityId: uuid('facility_id').notNull(),
    storeId: uuid('store_id').notNull(),
    storeName: text('store_name').notNull(),
    vendorId: uuid('vendor_id').notNull(),
    vendorName: text('vendor_name').notNull(),
    requisitionId: uuid('requisition_id'),
    status: text('status').notNull().default('draft'),
    expectedDate: date('expected_date', { mode: 'string' }),
    terms: text('terms'),
    notes: text('notes'),
    subtotal: money('subtotal').notNull().default('0'),
    taxTotal: money('tax_total').notNull().default('0'),
    total: money('total').notNull().default('0'),
    approvedBy: uuid('approved_by'),
    approvedAt: at('approved_at'),
    closedReason: text('closed_reason'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.facilityId], foreignColumns: [facilities.tenantId, facilities.id] }),
    foreignKey({ columns: [t.tenantId, t.storeId], foreignColumns: [pharmacyStores.tenantId, pharmacyStores.id] }),
    foreignKey({ columns: [t.tenantId, t.vendorId], foreignColumns: [inventoryVendors.tenantId, inventoryVendors.id] }),
    foreignKey({ columns: [t.tenantId, t.requisitionId], foreignColumns: [inventoryRequisitions.tenantId, inventoryRequisitions.id] }),
    uniqueIndex('proc_purchase_orders_number_uq').on(t.tenantId, t.number),
    index('proc_purchase_orders_status_idx').on(t.tenantId, t.status, t.createdAt),
    index('proc_purchase_orders_vendor_idx').on(t.tenantId, t.vendorId, t.createdAt),
  ],
);

export const inventoryPurchaseOrderLines = pg.table(
  'proc_purchase_order_lines',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    purchaseOrderId: uuid('purchase_order_id').notNull(),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id').notNull(),
    itemCode: text('item_code').notNull(),
    itemName: text('item_name').notNull(),
    unit: text('unit').notNull(),
    qty: integer('qty').notNull(),
    receivedQty: integer('received_qty').notNull().default(0),
    rate: money('rate').notNull(),
    gstRate: rate('gst_rate').notNull(),
    taxAmount: money('tax_amount').notNull(),
    amount: money('amount').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.purchaseOrderId], foreignColumns: [inventoryPurchaseOrders.tenantId, inventoryPurchaseOrders.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.itemId], foreignColumns: [pharmacyItems.tenantId, pharmacyItems.id] }),
    index('proc_purchase_order_lines_po_idx').on(t.tenantId, t.purchaseOrderId),
  ],
);

export const inventoryGrns = pg.table(
  'proc_grns',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    number: text('number').notNull(),
    purchaseOrderId: uuid('purchase_order_id').notNull(),
    facilityId: uuid('facility_id').notNull(),
    storeId: uuid('store_id').notNull(),
    vendorId: uuid('vendor_id').notNull(),
    vendorName: text('vendor_name').notNull(),
    invoiceNo: text('invoice_no'),
    invoiceDate: date('invoice_date', { mode: 'string' }),
    total: money('total').notNull().default('0'),
    notes: text('notes'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.purchaseOrderId], foreignColumns: [inventoryPurchaseOrders.tenantId, inventoryPurchaseOrders.id] }),
    foreignKey({ columns: [t.tenantId, t.facilityId], foreignColumns: [facilities.tenantId, facilities.id] }),
    foreignKey({ columns: [t.tenantId, t.storeId], foreignColumns: [pharmacyStores.tenantId, pharmacyStores.id] }),
    foreignKey({ columns: [t.tenantId, t.vendorId], foreignColumns: [inventoryVendors.tenantId, inventoryVendors.id] }),
    uniqueIndex('proc_grns_number_uq').on(t.tenantId, t.number),
    index('proc_grns_po_idx').on(t.tenantId, t.purchaseOrderId),
  ],
);

export const inventoryGrnLines = pg.table(
  'proc_grn_lines',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    grnId: uuid('grn_id').notNull(),
    poLineId: uuid('po_line_id').notNull(),
    itemId: uuid('item_id').notNull(),
    itemName: text('item_name').notNull(),
    batchId: uuid('batch_id').notNull(),
    batchNo: text('batch_no').notNull(),
    expiryDate: date('expiry_date', { mode: 'string' }).notNull(),
    qty: integer('qty').notNull(),
    freeQty: integer('free_qty').notNull().default(0),
    returnedQty: integer('returned_qty').notNull().default(0),
    rate: money('rate').notNull(),
    gstRate: rate('gst_rate').notNull(),
    mrp: money('mrp').notNull(),
    amount: money('amount').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.grnId], foreignColumns: [inventoryGrns.tenantId, inventoryGrns.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.poLineId], foreignColumns: [inventoryPurchaseOrderLines.tenantId, inventoryPurchaseOrderLines.id] }),
    foreignKey({ columns: [t.tenantId, t.itemId], foreignColumns: [pharmacyItems.tenantId, pharmacyItems.id] }),
    foreignKey({ columns: [t.tenantId, t.batchId], foreignColumns: [pharmacyBatches.tenantId, pharmacyBatches.id] }),
    index('proc_grn_lines_grn_idx').on(t.tenantId, t.grnId),
  ],
);

export const inventoryPurchaseReturns = pg.table(
  'proc_purchase_returns',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    number: text('number').notNull(),
    grnId: uuid('grn_id').notNull(),
    storeId: uuid('store_id').notNull(),
    vendorId: uuid('vendor_id').notNull(),
    reason: text('reason').notNull(),
    total: money('total').notNull().default('0'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.grnId], foreignColumns: [inventoryGrns.tenantId, inventoryGrns.id] }),
    foreignKey({ columns: [t.tenantId, t.storeId], foreignColumns: [pharmacyStores.tenantId, pharmacyStores.id] }),
    foreignKey({ columns: [t.tenantId, t.vendorId], foreignColumns: [inventoryVendors.tenantId, inventoryVendors.id] }),
    uniqueIndex('proc_purchase_returns_number_uq').on(t.tenantId, t.number),
  ],
);

export const inventoryPurchaseReturnLines = pg.table(
  'proc_purchase_return_lines',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    purchaseReturnId: uuid('purchase_return_id').notNull(),
    grnLineId: uuid('grn_line_id').notNull(),
    itemId: uuid('item_id').notNull(),
    batchId: uuid('batch_id').notNull(),
    qty: integer('qty').notNull(),
    amount: money('amount').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.purchaseReturnId], foreignColumns: [inventoryPurchaseReturns.tenantId, inventoryPurchaseReturns.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.grnLineId], foreignColumns: [inventoryGrnLines.tenantId, inventoryGrnLines.id] }),
    foreignKey({ columns: [t.tenantId, t.itemId], foreignColumns: [pharmacyItems.tenantId, pharmacyItems.id] }),
    foreignKey({ columns: [t.tenantId, t.batchId], foreignColumns: [pharmacyBatches.tenantId, pharmacyBatches.id] }),
  ],
);

export const inventoryIndents = pg.table(
  'proc_indents',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    number: text('number').notNull(),
    facilityId: uuid('facility_id').notNull(),
    toStoreId: uuid('to_store_id').notNull(),
    toStoreName: text('to_store_name').notNull(),
    fromStoreId: uuid('from_store_id').notNull(),
    fromStoreName: text('from_store_name').notNull(),
    priority: text('priority').notNull().default('normal'),
    status: text('status').notNull().default('submitted'),
    notes: text('notes'),
    decidedBy: uuid('decided_by'),
    decidedAt: at('decided_at'),
    decisionNote: text('decision_note'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.facilityId], foreignColumns: [facilities.tenantId, facilities.id] }),
    foreignKey({ columns: [t.tenantId, t.toStoreId], foreignColumns: [pharmacyStores.tenantId, pharmacyStores.id] }),
    foreignKey({ columns: [t.tenantId, t.fromStoreId], foreignColumns: [pharmacyStores.tenantId, pharmacyStores.id] }),
    uniqueIndex('proc_indents_number_uq').on(t.tenantId, t.number),
    index('proc_indents_status_idx').on(t.tenantId, t.status, t.createdAt),
  ],
);

export const inventoryIndentLines = pg.table(
  'proc_indent_lines',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    indentId: uuid('indent_id').notNull(),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id').notNull(),
    itemCode: text('item_code').notNull(),
    itemName: text('item_name').notNull(),
    unit: text('unit').notNull(),
    requestedQty: integer('requested_qty').notNull(),
    approvedQty: integer('approved_qty'),
    issuedQty: integer('issued_qty').notNull().default(0),
    note: text('note'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.indentId], foreignColumns: [inventoryIndents.tenantId, inventoryIndents.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.itemId], foreignColumns: [pharmacyItems.tenantId, pharmacyItems.id] }),
    index('proc_indent_lines_indent_idx').on(t.tenantId, t.indentId),
  ],
);

export const inventoryIssues = pg.table(
  'proc_issues',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    number: text('number').notNull(),
    indentId: uuid('indent_id').notNull(),
    fromStoreId: uuid('from_store_id').notNull(),
    toStoreId: uuid('to_store_id').notNull(),
    notes: text('notes'),
    /** Issued for a patient / IPD admission: consumables charged to the patient (billing rule). */
    patientId: uuid('patient_id'),
    admissionId: uuid('admission_id'),
    patientName: text('patient_name'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.indentId], foreignColumns: [inventoryIndents.tenantId, inventoryIndents.id] }),
    foreignKey({ columns: [t.tenantId, t.fromStoreId], foreignColumns: [pharmacyStores.tenantId, pharmacyStores.id] }),
    foreignKey({ columns: [t.tenantId, t.toStoreId], foreignColumns: [pharmacyStores.tenantId, pharmacyStores.id] }),
    uniqueIndex('proc_issues_number_uq').on(t.tenantId, t.number),
    index('proc_issues_indent_idx').on(t.tenantId, t.indentId),
  ],
);

export const inventoryIssueLines = pg.table(
  'proc_issue_lines',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    issueId: uuid('issue_id').notNull(),
    indentLineId: uuid('indent_line_id').notNull(),
    itemId: uuid('item_id').notNull(),
    batchId: uuid('batch_id').notNull(),
    batchNo: text('batch_no').notNull(),
    expiryDate: date('expiry_date', { mode: 'string' }).notNull(),
    qty: integer('qty').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.issueId], foreignColumns: [inventoryIssues.tenantId, inventoryIssues.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.indentLineId], foreignColumns: [inventoryIndentLines.tenantId, inventoryIndentLines.id] }),
    foreignKey({ columns: [t.tenantId, t.itemId], foreignColumns: [pharmacyItems.tenantId, pharmacyItems.id] }),
    foreignKey({ columns: [t.tenantId, t.batchId], foreignColumns: [pharmacyBatches.tenantId, pharmacyBatches.id] }),
    index('proc_issue_lines_issue_idx').on(t.tenantId, t.issueId),
  ],
);
