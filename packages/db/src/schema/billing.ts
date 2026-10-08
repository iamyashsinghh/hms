/**
 * Billing tables. Owned by the "billing" workstream (Postgres schema: billing).
 * Money is numeric(14,2) and comes back from Drizzle as a string; convert with the helpers in the billing module.
 * Kept in sync with migrations/*_billing_*.sql (pnpm test checks it).
 */
import { sql } from 'drizzle-orm';
import { boolean, date, foreignKey, index, integer, jsonb, numeric, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { actorColumns, billing as pg, idColumn, tenantIdColumn, timestamps } from './_common';
import { facilities, patients, users } from './core';

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const billingSettings = pg.table(
  'settings',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    legalName: text('legal_name'),
    gstin: text('gstin'),
    stateCode: text('state_code'),
    address: text('address'),
    phone: text('phone'),
    upiVpa: text('upi_vpa'),
    upiPayeeName: text('upi_payee_name'),
    invoiceFooter: text('invoice_footer'),
    roundOff: boolean('round_off').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('billing_settings_tenant_uq').on(t.tenantId)],
);

export const billingServices = pg.table(
  'services',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull().default('other'),
    departmentId: uuid('department_id'),
    hsnSac: text('hsn_sac'),
    basePrice: money('base_price').notNull().default('0'),
    taxRate: numeric('tax_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    isActive: boolean('is_active').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('billing_services_code_uq').on(t.tenantId, t.code)],
);

export const billingPackageItems = pg.table(
  'package_items',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    packageId: uuid('package_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    qty: numeric('qty', { precision: 12, scale: 3 }).notNull().default('1'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.packageId], foreignColumns: [billingServices.tenantId, billingServices.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.serviceId], foreignColumns: [billingServices.tenantId, billingServices.id] }),
    uniqueIndex('billing_package_items_uq').on(t.tenantId, t.packageId, t.serviceId),
  ],
);

export const billingPriceLists = pg.table(
  'price_lists',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    name: text('name').notNull(),
    payerId: uuid('payer_id'),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull().default(sql`current_date`),
    effectiveTo: date('effective_to', { mode: 'string' }),
    isActive: boolean('is_active').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index('billing_price_lists_payer_idx').on(t.tenantId, t.payerId, t.effectiveFrom)],
);

export const billingPriceListItems = pg.table(
  'price_list_items',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    priceListId: uuid('price_list_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    price: money('price').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.priceListId], foreignColumns: [billingPriceLists.tenantId, billingPriceLists.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.serviceId], foreignColumns: [billingServices.tenantId, billingServices.id] }),
    uniqueIndex('billing_price_list_items_uq').on(t.tenantId, t.priceListId, t.serviceId),
  ],
);

export const billingCashShifts = pg.table(
  'cash_shifts',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    facilityId: uuid('facility_id').notNull(),
    userId: uuid('user_id').notNull(),
    status: text('status').notNull().default('open'),
    openedAt: ts('opened_at').notNull().defaultNow(),
    openingCash: money('opening_cash').notNull().default('0'),
    closedAt: ts('closed_at'),
    expectedCash: money('expected_cash'),
    countedCash: money('counted_cash'),
    difference: money('difference'),
    totals: jsonb('totals').$type<Record<string, string>>(),
    notes: text('notes'),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.facilityId], foreignColumns: [facilities.tenantId, facilities.id] }),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }),
  ],
);

export const billingInvoices = pg.table(
  'invoices',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    number: text('number'),
    facilityId: uuid('facility_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    patientName: text('patient_name').notNull(),
    patientUhid: text('patient_uhid').notNull(),
    patientMobile: text('patient_mobile'),
    status: text('status').notNull().default('draft'),
    sourceModule: text('source_module').notNull().default('billing'),
    sourceRef: text('source_ref'),
    payerId: uuid('payer_id'),
    doctorId: uuid('doctor_id'),
    invoiceDate: date('invoice_date', { mode: 'string' }).notNull().default(sql`current_date`),
    supplyType: text('supply_type').notNull().default('intra'),
    buyerGstin: text('buyer_gstin'),
    sellerName: text('seller_name'),
    sellerGstin: text('seller_gstin'),
    subtotal: money('subtotal').notNull().default('0'),
    discountTotal: money('discount_total').notNull().default('0'),
    taxableTotal: money('taxable_total').notNull().default('0'),
    cgstTotal: money('cgst_total').notNull().default('0'),
    sgstTotal: money('sgst_total').notNull().default('0'),
    igstTotal: money('igst_total').notNull().default('0'),
    taxTotal: money('tax_total').notNull().default('0'),
    roundOff: money('round_off').notNull().default('0'),
    total: money('total').notNull().default('0'),
    paidAmount: money('paid_amount').notNull().default('0'),
    creditedAmount: money('credited_amount').notNull().default('0'),
    notes: text('notes'),
    finalizedAt: ts('finalized_at'),
    finalizedBy: uuid('finalized_by'),
    cancelledAt: ts('cancelled_at'),
    cancelledBy: uuid('cancelled_by'),
    cancelReason: text('cancel_reason'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.facilityId], foreignColumns: [facilities.tenantId, facilities.id] }),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }),
    uniqueIndex('billing_invoices_number_uq').on(t.tenantId, t.number),
    index('billing_invoices_patient_idx').on(t.tenantId, t.patientId, t.createdAt),
  ],
);

export const billingInvoiceLines = pg.table(
  'invoice_lines',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    invoiceId: uuid('invoice_id').notNull(),
    lineNo: integer('line_no').notNull(),
    serviceId: uuid('service_id'),
    serviceCode: text('service_code'),
    itemId: uuid('item_id'),
    description: text('description').notNull(),
    hsnSac: text('hsn_sac'),
    qty: numeric('qty', { precision: 12, scale: 3 }).notNull(),
    unitPrice: money('unit_price').notNull(),
    discount: money('discount').notNull().default('0'),
    taxRate: numeric('tax_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    taxableAmount: money('taxable_amount').notNull(),
    taxAmount: money('tax_amount').notNull(),
    total: money('total').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.invoiceId], foreignColumns: [billingInvoices.tenantId, billingInvoices.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.serviceId], foreignColumns: [billingServices.tenantId, billingServices.id] }),
    uniqueIndex('billing_invoice_lines_no_uq').on(t.tenantId, t.invoiceId, t.lineNo),
  ],
);

export const billingPayments = pg.table(
  'payments',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    number: text('number').notNull(),
    kind: text('kind').notNull(),
    facilityId: uuid('facility_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    invoiceId: uuid('invoice_id'),
    mode: text('mode').notNull(),
    amount: money('amount').notNull(),
    reference: text('reference'),
    notes: text('notes'),
    shiftId: uuid('shift_id'),
    receivedBy: uuid('received_by'),
    receivedAt: ts('received_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.facilityId], foreignColumns: [facilities.tenantId, facilities.id] }),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }),
    foreignKey({ columns: [t.tenantId, t.invoiceId], foreignColumns: [billingInvoices.tenantId, billingInvoices.id] }),
    foreignKey({ columns: [t.tenantId, t.shiftId], foreignColumns: [billingCashShifts.tenantId, billingCashShifts.id] }),
    uniqueIndex('billing_payments_number_uq').on(t.tenantId, t.number),
  ],
);

export const billingCreditNotes = pg.table(
  'credit_notes',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    number: text('number').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    amount: money('amount').notNull(),
    reason: text('reason').notNull(),
    reference: text('reference'),
    createdBy: uuid('created_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.invoiceId], foreignColumns: [billingInvoices.tenantId, billingInvoices.id] }),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }),
    uniqueIndex('billing_credit_notes_number_uq').on(t.tenantId, t.number),
  ],
);

/** What a patient owes, posted by any department; pending until billed into one invoice. */
export const billingCharges = pg.table(
  'charges',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    facilityId: uuid('facility_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    account: text('account').notNull().default('opd'),
    visitId: uuid('visit_id'),
    admissionId: uuid('admission_id'),
    sourceModule: text('source_module').notNull(),
    sourceRef: text('source_ref').notNull(),
    sourceLine: text('source_line').notNull().default(''),
    serviceId: uuid('service_id'),
    serviceCode: text('service_code'),
    itemId: uuid('item_id'),
    description: text('description').notNull(),
    hsnSac: text('hsn_sac'),
    qty: numeric('qty', { precision: 12, scale: 3 }).notNull(),
    unitPrice: money('unit_price').notNull(),
    priceIncludesTax: boolean('price_includes_tax').notNull().default(false),
    taxRate: numeric('tax_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    discount: money('discount').notNull().default('0'),
    doctorId: uuid('doctor_id'),
    chargeDate: date('charge_date', { mode: 'string' }).notNull().default(sql`current_date`),
    status: text('status').notNull().default('pending'),
    invoiceId: uuid('invoice_id'),
    invoiceLineNo: integer('invoice_line_no'),
    cancelReason: text('cancel_reason'),
    cancelledAt: ts('cancelled_at'),
    cancelledBy: uuid('cancelled_by'),
    reversalRequestedAt: ts('reversal_requested_at'),
    reversalReason: text('reversal_reason'),
    reversalDoneAt: ts('reversal_done_at'),
    notes: text('notes'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.facilityId], foreignColumns: [facilities.tenantId, facilities.id] }),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }),
    foreignKey({ columns: [t.tenantId, t.serviceId], foreignColumns: [billingServices.tenantId, billingServices.id] }),
    foreignKey({ columns: [t.tenantId, t.invoiceId], foreignColumns: [billingInvoices.tenantId, billingInvoices.id] }),
    uniqueIndex('billing_charges_source_uq').on(t.tenantId, t.sourceModule, t.sourceRef, t.sourceLine),
    index('billing_charges_patient_idx').on(t.tenantId, t.patientId, t.status, t.createdAt),
  ],
);

/** Billing rules: one row for the hospital (facilityId null) and optional branch overrides. */
export const billingRuleSets = pg.table(
  'rule_sets',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    facilityId: uuid('facility_id'),
    rules: jsonb('rules').$type<Record<string, unknown>>().notNull().default({}),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.facilityId], foreignColumns: [facilities.tenantId, facilities.id] }),
  ],
);
