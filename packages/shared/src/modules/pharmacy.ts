import { z } from 'zod';
import { defineModule } from '../manifest';
import { patchSchema } from '../patch';

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

const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).optional();
const money = z.number().min(0).max(10_000_000);
const qty = z.number().int().min(1).max(1_000_000);
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

export const createItemSchema = z.object({
  code: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9._/-]+$/, 'Letters, digits and . _ / - only'),
  name: text(200),
  genericName: optText(200),
  form: z.enum(ITEM_FORMS).default('tablet'),
  strength: optText(60),
  manufacturer: optText(120),
  hsnCode: z.string().regex(/^\d{4,8}$/, 'HSN is 4 to 8 digits').optional(),
  gstRate: z.number().min(0).max(40).default(5),
  /** Sale unit, e.g. tablet, strip, bottle. Stock and prices are per this unit. */
  unit: z.string().trim().min(1).max(20).default('unit'),
  packSize: z.number().int().min(1).max(10_000).default(1),
  schedule: z.enum(DRUG_SCHEDULES).default('otc'),
  reorderLevel: z.number().int().min(0).max(1_000_000).default(0),
});
export type CreateItem = z.input<typeof createItemSchema>;

// patchSchema, not .partial(): Zod 4 keeps defaults inside .partial(), so e.g. deactivating an item reset its GST rate to 5%.
export const updateItemSchema = patchSchema(createItemSchema.omit({ code: true })).extend({
  /** '' clears the HSN code. */
  hsnCode: createItemSchema.shape.hsnCode.or(z.literal('')),
  isActive: z.boolean().optional(),
});
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
  code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/),
  name: text(100),
  type: z.enum(STORE_TYPES).default('pharmacy'),
});
export type CreateStore = z.input<typeof createStoreSchema>;
export const updateStoreSchema = z.object({ name: text(100).optional(), type: z.enum(STORE_TYPES).optional(), isActive: z.boolean().optional() });
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
  itemId: z.uuid(),
  batchNo: z.string().trim().min(1).max(40),
  expiryDate: z.iso.date(),
  mrp: money,
  purchaseRate: money.default(0),
  /** Defaults to MRP. */
  saleRate: money.optional(),
  qty,
};

export const openingStockSchema = z.object({
  storeId: z.uuid(),
  lines: z.array(z.object(incomingBatch)).min(1).max(500),
});
export type OpeningStock = z.input<typeof openingStockSchema>;

export const createGrnSchema = z.object({
  storeId: z.uuid(),
  supplierName: text(200),
  supplierGstin: z.string().trim().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Invalid GSTIN').optional(),
  invoiceNo: optText(60),
  invoiceDate: z.iso.date().optional(),
  notes: optText(500),
  lines: z
    .array(z.object({ ...incomingBatch, freeQty: z.number().int().min(0).max(1_000_000).default(0), gstRate: z.number().min(0).max(40).optional() }))
    .min(1)
    .max(500),
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
  qtyChange: z.number().int().min(-1_000_000).max(1_000_000).refine((v) => v !== 0, 'Quantity cannot be zero'),
  type: z.enum(ADJUSTMENT_TYPES).default('adjustment'),
  reason: text(300),
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
  discountPct: z.number().min(0).max(100).default(0),
});

export const createSaleSchema = z.object({
  storeId: z.uuid(),
  patientId: z.uuid().optional(),
  customerName: optText(120),
  customerMobile: z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number').optional(),
  paymentMode: z.enum(PAYMENT_MODES).default('cash'),
  /** Confirms a prescription was seen for Schedule H/H1/X items sold over the counter. */
  prescriptionSeen: z.boolean().default(false),
  lines: z.array(saleLineInputSchema).min(1).max(100),
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

export const saleListQuerySchema = z.object({
  q: z.string().trim().max(60).optional(),
  type: z.enum(['otc', 'rx']).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  ...pageQuery,
});
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
  days: z.number().int().min(0).max(365).optional(),
  qty: z.number().int().min(0).max(100_000),
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
        discountPct: z.number().min(0).max(100).default(0),
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
