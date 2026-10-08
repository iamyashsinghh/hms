import { z } from 'zod';
import { defineModule } from '../manifest';
import { GST_RATES } from './billing';
import {
  blankToUndefined,
  datesInOrder,
  END_BEFORE_START,
  expiryDate,
  GSTIN_REGEX,
  hsnCode,
  indianMobile,
  isoDate,
  money as moneyField,
  pastOrTodayDate,
  percent,
  quantity,
  requiredText,
  todayIso,
} from '../validation';

/**
 * Pharmacy: permissions and API contracts (Zod schemas + types).
 * Owned by the "pharmacy" workstream. Quantities are whole units of the item's sale unit (item.unit);
 * prices are per unit and include GST (MRP-style), money values are rupees with 2 decimals.
 */
export const pharmacyModule = defineModule({
  key: 'pharmacy',
  name: 'Pharmacy',
  permissions: [
    { key: 'pharmacy.item.read', description: 'View the drug / item master' },
    { key: 'pharmacy.item.manage', description: 'Create and edit drugs and items' },
    { key: 'pharmacy.store.manage', description: 'Create and edit pharmacy stores' },
    { key: 'pharmacy.stock.read', description: 'View stock, batches, expiry and the stock ledger' },
    { key: 'pharmacy.stock.receive', description: 'Enter opening stock and goods receipts (GRN)' },
    { key: 'pharmacy.stock.adjust', description: 'Adjust stock and write off expired batches' },
    { key: 'pharmacy.sale.read', description: 'View pharmacy sales and returns' },
    { key: 'pharmacy.sale.create', description: 'Make OTC sales' },
    { key: 'pharmacy.sale.return', description: 'Take back sold items and refund' },
    { key: 'pharmacy.prescription.read', description: 'View the prescription dispense queue' },
    { key: 'pharmacy.prescription.create', description: 'Enter paper prescriptions into the dispense queue' },
    { key: 'pharmacy.prescription.dispense', description: 'Dispense prescriptions' },
  ],
  grants: {
    hospital_admin: [
      'pharmacy.item.read', 'pharmacy.item.manage', 'pharmacy.store.manage', 'pharmacy.stock.read', 'pharmacy.stock.receive',
      'pharmacy.stock.adjust', 'pharmacy.sale.read', 'pharmacy.sale.create', 'pharmacy.sale.return', 'pharmacy.prescription.read',
      'pharmacy.prescription.create', 'pharmacy.prescription.dispense',
    ],
    pharmacist: [
      'pharmacy.item.read', 'pharmacy.item.manage', 'pharmacy.stock.read', 'pharmacy.stock.receive', 'pharmacy.stock.adjust',
      'pharmacy.sale.read', 'pharmacy.sale.create', 'pharmacy.sale.return', 'pharmacy.prescription.read',
      'pharmacy.prescription.create', 'pharmacy.prescription.dispense',
    ],
    store_keeper: ['pharmacy.item.read', 'pharmacy.item.manage', 'pharmacy.stock.read', 'pharmacy.stock.receive', 'pharmacy.stock.adjust'],
    owner: ['pharmacy.item.read', 'pharmacy.stock.read', 'pharmacy.sale.read', 'pharmacy.prescription.read'],
    accountant: ['pharmacy.item.read', 'pharmacy.stock.read', 'pharmacy.sale.read'],
    billing_clerk: ['pharmacy.item.read', 'pharmacy.sale.read'],
    doctor: ['pharmacy.item.read', 'pharmacy.stock.read'],
    nurse: ['pharmacy.item.read', 'pharmacy.stock.read'],
  },
});

// ---------- helpers ----------

const text = (max: number, label = 'this field') => requiredText(label, max);
const optText = (max: number) => z.string().trim().max(max, `Can be at most ${max} characters`).optional();
const money = moneyField(10_000_000);
const qty = quantity(1, 1_000_000);

/** GST must be one of the slabs Billing accepts, or a patient sale of the item cannot be billed. */
export const GST_SLAB_MESSAGE = `Use a GST slab: ${GST_RATES.slice(0, -1).join(', ')} or ${GST_RATES[GST_RATES.length - 1]}`;
export const isGstSlab = (v: number) => (GST_RATES as readonly number[]).includes(v);
const gstSlab = z.coerce.number({ error: 'Pick a GST rate' }).refine(isGstSlab, GST_SLAB_MESSAGE);
const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
};
/** Query params as a client sends them. */
export type PageQuery = { page?: number; pageSize?: number };

// ---------- items ----------

export const ITEM_FORMS = [
  'tablet', 'capsule', 'syrup', 'suspension', 'injection', 'ointment', 'cream', 'drops',
  'inhaler', 'powder', 'solution', 'device', 'consumable', 'other',
] as const;
export const DRUG_SCHEDULES = ['otc', 'G', 'H', 'H1', 'X', 'narcotic'] as const;
/** Schedules that need a prescription before sale (Drugs and Cosmetics Rules). */
export const RX_ONLY_SCHEDULES: readonly string[] = ['H', 'H1', 'X', 'narcotic'];

const packSize = z.coerce.number().int('Units per pack must be a whole number').min(1, 'Units per pack must be at least 1').max(10_000, 'Units per pack cannot be more than 10,000');
const reorderLevel = z.coerce.number().int('Reorder level must be a whole number').min(0, 'Reorder level cannot be negative').max(1_000_000, 'Reorder level is too large');
/** Item fields without defaults, so a partial update never resets a field the caller did not send. */
const itemFields = {
  name: text(200, 'the drug name'),
  genericName: optText(200),
  form: z.enum(ITEM_FORMS),
  strength: optText(60),
  manufacturer: optText(120),
  hsnCode: blankToUndefined(hsnCode.optional()),
  gstRate: gstSlab,
  /** Sale unit, e.g. tablet, strip, bottle. Stock and prices are per this unit. */
  unit: requiredText('the sale unit', 20),
  packSize,
  schedule: z.enum(DRUG_SCHEDULES),
  reorderLevel,
};

export const createItemSchema = z.object({
  ...itemFields,
  code: z.string().trim().min(1, 'Enter a code').max(40, 'Code can be at most 40 characters').regex(/^[A-Za-z0-9._/-]+$/, 'Letters, digits and . _ / - only'),
  form: itemFields.form.default('tablet'),
  gstRate: gstSlab.default(5),
  unit: itemFields.unit.default('unit'),
  packSize: packSize.default(1),
  schedule: itemFields.schedule.default('otc'),
  reorderLevel: reorderLevel.default(0),
});
export type CreateItem = z.input<typeof createItemSchema>;

export const updateItemSchema = z.object(itemFields).partial().extend({ isActive: z.boolean().optional() });
export type UpdateItem = z.input<typeof updateItemSchema>;

export interface Item {
  id: string;
  code: string;
  name: string;
  genericName: string | null;
  form: (typeof ITEM_FORMS)[number];
  strength: string | null;
  manufacturer: string | null;
  hsnCode: string | null;
  gstRate: number;
  unit: string;
  packSize: number;
  schedule: (typeof DRUG_SCHEDULES)[number];
  reorderLevel: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const itemSearchQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  includeInactive: z.stringbool().default(false),
  ...pageQuery,
});
export type ItemSearchQuery = PageQuery & { q?: string; includeInactive?: boolean };

// ---------- stores ----------

export const STORE_TYPES = ['pharmacy', 'main', 'ward', 'ot', 'other'] as const;

export const createStoreSchema = z.object({
  facilityId: z.uuid(),
  code: z.string().trim().min(1, 'Enter a code').max(20, 'Code can be at most 20 characters').regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, - and _ only'),
  name: text(100, 'the store name'),
  type: z.enum(STORE_TYPES).default('pharmacy'),
});
export type CreateStore = z.input<typeof createStoreSchema>;
export const updateStoreSchema = z.object({ name: text(100, 'the store name').optional(), type: z.enum(STORE_TYPES).optional(), isActive: z.boolean().optional() });
export type UpdateStore = z.input<typeof updateStoreSchema>;

export interface Store {
  id: string;
  facilityId: string;
  code: string;
  name: string;
  type: (typeof STORE_TYPES)[number];
  isActive: boolean;
}

// ---------- stock ----------

/** A batch arriving in stock (opening stock or GRN). An existing item + batch no + expiry is reused. */
const incomingBatch = {
  itemId: z.uuid({ error: 'Pick a drug' }),
  batchNo: requiredText('the batch number', 40),
  /** Opening stock may record already-expired units (to write them off); a GRN may not. */
  expiryDate,
  mrp: money.refine((v) => v > 0, 'MRP must be more than 0'),
  purchaseRate: money.default(0),
  /** Defaults to MRP. */
  saleRate: money.optional(),
  qty,
};
const saleRateWithinMrp = (l: { mrp: number; saleRate?: number }) => l.saleRate === undefined || l.saleRate <= l.mrp;
const SALE_RATE_ABOVE_MRP = { message: 'Sale rate cannot be more than MRP', path: ['saleRate'] };
const incomingBatchLine = z.object(incomingBatch).refine(saleRateWithinMrp, SALE_RATE_ABOVE_MRP);

export const openingStockSchema = z.object({
  storeId: z.uuid({ error: 'Pick a store' }),
  lines: z.array(incomingBatchLine).min(1, 'Add at least one line').max(500),
});
export type OpeningStock = z.input<typeof openingStockSchema>;

export const grnLineSchema = z
  .object({
    ...incomingBatch,
    freeQty: quantity(0, 1_000_000).default(0),
    gstRate: gstSlab.optional(),
  })
  .refine(saleRateWithinMrp, SALE_RATE_ABOVE_MRP)
  .refine((l) => l.expiryDate > todayIso(), { message: 'This batch has already expired (expiry must be after today)', path: ['expiryDate'] });

export const createGrnSchema = z.object({
  storeId: z.uuid({ error: 'Pick a store' }),
  supplierName: text(200, 'the supplier name'),
  supplierGstin: blankToUndefined(z.string().trim().toUpperCase().regex(GSTIN_REGEX, 'Invalid GSTIN: enter the 15-character GSTIN').optional()),
  invoiceNo: blankToUndefined(optText(60)),
  invoiceDate: blankToUndefined(pastOrTodayDate('Invoice date').optional()),
  notes: optText(500),
  lines: z.array(grnLineSchema).min(1, 'Add at least one line').max(500),
});
export type CreateGrn = z.input<typeof createGrnSchema>;

export interface GrnLine {
  id: string;
  itemId: string;
  itemName: string;
  batchId: string;
  batchNo: string;
  expiryDate: string;
  qty: number;
  freeQty: number;
  purchaseRate: number;
  mrp: number;
  gstRate: number;
  amount: number;
}

export interface Grn {
  id: string;
  number: string;
  storeId: string;
  supplierName: string;
  supplierGstin: string | null;
  invoiceNo: string | null;
  invoiceDate: string | null;
  status: 'posted' | 'cancelled';
  totalAmount: number;
  notes: string | null;
  createdAt: string;
  lines?: GrnLine[];
}

export const ADJUSTMENT_TYPES = ['adjustment', 'expiry_writeoff'] as const;
export const stockAdjustmentSchema = z.object({
  storeId: z.uuid(),
  batchId: z.uuid(),
  /** Positive adds stock, negative removes it. Expiry write-offs must be negative. */
  qtyChange: z.coerce
    .number({ error: 'Enter a quantity' })
    .int('Quantity must be a whole number')
    .min(-1_000_000, 'Quantity is too large')
    .max(1_000_000, 'Quantity is too large')
    .refine((v) => v !== 0, 'Quantity cannot be zero'),
  type: z.enum(ADJUSTMENT_TYPES).default('adjustment'),
  reason: text(300, 'a reason'),
}).refine((v) => v.type !== 'expiry_writeoff' || v.qtyChange < 0, {
  message: 'An expiry write-off removes stock; use a negative quantity',
  path: ['qtyChange'],
});
export type StockAdjustment = z.input<typeof stockAdjustmentSchema>;

export const stockQuerySchema = z.object({
  storeId: z.uuid(),
  q: z.string().trim().max(100).optional(),
  /** Only items at or below their reorder level. */
  lowOnly: z.stringbool().default(false),
  ...pageQuery,
});
export type StockQuery = PageQuery & { storeId: string; q?: string; lowOnly?: boolean };

export interface StockRow {
  itemId: string;
  code: string;
  name: string;
  genericName: string | null;
  form: string;
  strength: string | null;
  unit: string;
  schedule: string;
  reorderLevel: number;
  qty: number;
  /** Units in batches that are already expired (not sellable). */
  expiredQty: number;
  nearestExpiry: string | null;
  isLow: boolean;
}

export interface BatchStock {
  batchId: string;
  itemId: string;
  batchNo: string;
  expiryDate: string;
  mrp: number;
  saleRate: number;
  purchaseRate: number;
  qty: number;
  isExpired: boolean;
}

export const expiringQuerySchema = z.object({
  storeId: z.uuid(),
  days: z.coerce.number().int().min(0).max(730).default(90),
});
export type ExpiringQuery = { storeId: string; days?: number };

export interface ExpiringBatch extends BatchStock {
  itemCode: string;
  itemName: string;
  daysToExpiry: number;
}

export const LEDGER_TYPES = [
  'opening', 'grn', 'sale', 'dispense', 'sale_return', 'purchase_return',
  'adjustment', 'expiry_writeoff', 'transfer_in', 'transfer_out',
] as const;

export const ledgerQuerySchema = z.object({
  storeId: z.uuid().optional(),
  itemId: z.uuid().optional(),
  ...pageQuery,
});
export type LedgerQuery = PageQuery & { storeId?: string; itemId?: string };

export interface LedgerEntry {
  id: string;
  storeId: string;
  itemId: string;
  itemName: string;
  batchId: string;
  batchNo: string;
  txnType: (typeof LEDGER_TYPES)[number];
  qtyChange: number;
  balanceAfter: number;
  refType: string | null;
  refId: string | null;
  note: string | null;
  createdAt: string;
}

// ---------- sales ----------

export const PAYMENT_MODES = ['cash', 'upi', 'card', 'credit'] as const;

/** One requested line. Without batchId the server picks batches first-expiry-first-out (FEFO). */
export const saleLineInputSchema = z.object({
  itemId: z.uuid(),
  qty,
  batchId: z.uuid().optional(),
  discountPct: percent.default(0),
});

export const createSaleSchema = z.object({
  storeId: z.uuid({ error: 'Pick a store' }),
  patientId: z.uuid().optional(),
  customerName: blankToUndefined(optText(120)),
  customerMobile: blankToUndefined(indianMobile.optional()),
  paymentMode: z.enum(PAYMENT_MODES).default('cash'),
  /** Confirms a prescription was seen for Schedule H/H1/X items sold over the counter. */
  prescriptionSeen: z.boolean().default(false),
  lines: z.array(saleLineInputSchema).min(1, 'Add at least one drug').max(100),
}).refine((v) => v.paymentMode !== 'credit' || !!v.patientId, {
  message: 'Credit sales need a registered patient (so the amount is billed to them)',
  path: ['paymentMode'],
});
export type CreateSale = z.input<typeof createSaleSchema>;

export interface SaleLine {
  id: string;
  itemId: string;
  itemName: string;
  batchId: string;
  batchNo: string;
  expiryDate: string;
  qty: number;
  returnedQty: number;
  unitPrice: number;
  discountPct: number;
  gstRate: number;
  taxableAmount: number;
  taxAmount: number;
  amount: number;
}

export interface Sale {
  id: string;
  number: string;
  type: 'otc' | 'rx';
  facilityId: string;
  storeId: string;
  patientId: string | null;
  customerName: string | null;
  customerMobile: string | null;
  pharmacyPrescriptionId: string | null;
  status: 'completed' | 'partially_returned' | 'returned';
  subtotal: number;
  discount: number;
  taxableAmount: number;
  taxAmount: number;
  total: number;
  returnedAmount: number;
  paymentMode: (typeof PAYMENT_MODES)[number] | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  createdAt: string;
  lines?: SaleLine[];
}

export const saleListQuerySchema = z
  .object({
    q: z.string().trim().max(60).optional(),
    type: z.enum(['otc', 'rx']).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    ...pageQuery,
  })
  .refine((v) => datesInOrder(v.from, v.to), { message: END_BEFORE_START, path: ['to'] });
export type SaleListQuery = PageQuery & { q?: string; type?: 'otc' | 'rx'; from?: string; to?: string };

export const createSaleReturnSchema = z.object({
  reason: optText(300),
  refundMode: z.enum(PAYMENT_MODES).default('cash'),
  lines: z.array(z.object({ saleLineId: z.uuid(), qty })).min(1).max(100),
});
export type CreateSaleReturn = z.input<typeof createSaleReturnSchema>;

export interface SaleReturn {
  id: string;
  number: string;
  saleId: string;
  refundAmount: number;
  refundMode: string | null;
  reason: string | null;
  /** Set when the sale was invoiced: the billing credit note and, if money went back, the refund receipt. */
  creditNoteNumber: string | null;
  billingRefundNumber: string | null;
  createdAt: string;
}

// ---------- prescriptions (dispense queue) ----------

export const RX_STATUSES = ['pending', 'partial', 'dispensed', 'cancelled'] as const;

export const rxLineSchema = z.object({
  drugName: text(200),
  itemCode: optText(40),
  itemId: z.uuid().optional(),
  dose: optText(60),
  frequency: optText(60),
  days: z.coerce.number().int('Days must be a whole number').min(0, 'Days cannot be negative').max(365, 'Days cannot be more than 365').optional(),
  qty: quantity(0, 100_000),
});

/** A paper prescription typed in at the counter. EMR prescriptions arrive by event. */
export const createPrescriptionSchema = z.object({
  patientId: z.uuid(),
  doctorName: optText(120),
  notes: optText(500),
  lines: z.array(rxLineSchema).min(1).max(50),
});
export type CreatePrescription = z.input<typeof createPrescriptionSchema>;

export interface PrescriptionLine {
  id: string;
  lineNo: number;
  drugName: string;
  itemCode: string | null;
  itemId: string | null;
  itemName: string | null;
  dose: string | null;
  frequency: string | null;
  days: number | null;
  qty: number;
  dispensedQty: number;
}

export interface Prescription {
  id: string;
  prescriptionId: string | null;
  source: 'emr' | 'manual';
  patientId: string;
  patientName: string;
  uhid: string;
  doctorId: string | null;
  doctorName: string | null;
  facilityId: string | null;
  status: (typeof RX_STATUSES)[number];
  notes: string | null;
  createdAt: string;
  lines: PrescriptionLine[];
}

export const prescriptionQuerySchema = z.object({
  status: z.enum([...RX_STATUSES, 'open']).default('open'),
  q: z.string().trim().max(60).optional(),
  ...pageQuery,
});
export type PrescriptionQuery = PageQuery & { status?: (typeof RX_STATUSES)[number] | 'open'; q?: string };

export const dispenseSchema = z.object({
  storeId: z.uuid(),
  paymentMode: z.enum(PAYMENT_MODES).default('cash'),
  lines: z
    .array(
      z.object({
        prescriptionLineId: z.uuid(),
        /** Item to give; defaults to the line's matched item (substitution allowed). */
        itemId: z.uuid().optional(),
        qty,
        batchId: z.uuid().optional(),
        discountPct: percent.default(0),
      }),
    )
    .min(1)
    .max(50),
});
export type Dispense = z.input<typeof dispenseSchema>;

// ---------- events (published by pharmacy) ----------

export interface PharmacyDispenseCompletedEvent {
  /** EMR prescription id (null for paper prescriptions). */
  prescriptionId: string | null;
  pharmacyPrescriptionId: string;
  saleId: string;
  invoiceId: string | null;
  patientId: string;
  status: 'partial' | 'dispensed';
}

export interface PharmacyStockLowEvent {
  itemId: string;
  storeId: string;
  qty: number;
  reorderLevel: number;
}

/** Consumed from EMR (contract in PARALLEL_PLAN.md section 4). */
export interface EmrPrescriptionCreatedEvent {
  prescriptionId: string;
  patientId: string;
  doctorId?: string;
  doctorName?: string;
  facilityId?: string;
  lines: { drugName: string; itemCode?: string; dose?: string; frequency?: string; days?: number; qty?: number }[];
}
