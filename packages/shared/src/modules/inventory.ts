import { z } from 'zod';
import { defineModule } from '../manifest';
import {
  blankToUndefined,
  emailAddress,
  expiryDate,
  gstin as gstinNumber,
  isoDate,
  money as moneyField,
  pan as panNumber,
  pastOrTodayDate,
  phoneNumber,
  quantity,
  todayIso,
  todayOrFutureDate,
} from '../validation';
import { patchSchema } from '../patch';
import type { ImportColumn } from '../imports';

/**
 * Inventory & Procurement: permissions and API contracts (Zod schemas + types).
 * Owned by the "inventory" workstream. Covers vendors, purchase requisitions, purchase orders, goods receipts
 * against a PO, purchase returns, and department indents with store-to-store issues.
 * Items, stores and stock are pharmacy's (`pharmacy.*` contracts); this module moves stock through PharmacyService.
 * Quantities are whole units of the item's unit; PO rates are per unit before GST; money is rupees with 2 decimals.
 */
export const inventoryModule = defineModule({
  key: 'inventory',
  name: 'Inventory & Procurement',
  permissions: [
    { key: 'inventory.vendor.read', description: 'View vendors' },
    { key: 'inventory.vendor.manage', description: 'Create and edit vendors' },
    { key: 'inventory.purchase.read', description: 'View purchase requisitions, purchase orders, GRNs and returns' },
    { key: 'inventory.purchase.request', description: 'Raise purchase requisitions' },
    { key: 'inventory.purchase.order', description: 'Create and edit purchase orders' },
    { key: 'inventory.purchase.approve', description: 'Approve or reject requisitions and purchase orders, cancel or close POs' },
    { key: 'inventory.grn.create', description: 'Receive goods against a purchase order and return goods to the vendor' },
    { key: 'inventory.indent.read', description: 'View department indents and issues' },
    { key: 'inventory.indent.create', description: 'Raise indents for a department store' },
    { key: 'inventory.indent.approve', description: 'Approve, reject or close indents' },
    { key: 'inventory.indent.issue', description: 'Issue stock from the central store against an indent' },
  ],
  grants: {
    hospital_admin: [
      'inventory.vendor.read', 'inventory.vendor.manage', 'inventory.purchase.read', 'inventory.purchase.request',
      'inventory.purchase.order', 'inventory.purchase.approve', 'inventory.grn.create', 'inventory.indent.read',
      'inventory.indent.create', 'inventory.indent.approve', 'inventory.indent.issue',
    ],
    store_keeper: [
      'inventory.vendor.read', 'inventory.vendor.manage', 'inventory.purchase.read', 'inventory.purchase.request',
      'inventory.purchase.order', 'inventory.grn.create', 'inventory.indent.read', 'inventory.indent.create',
      'inventory.indent.approve', 'inventory.indent.issue',
    ],
    owner: ['inventory.vendor.read', 'inventory.purchase.read', 'inventory.purchase.approve', 'inventory.indent.read'],
    accountant: ['inventory.vendor.read', 'inventory.vendor.manage', 'inventory.purchase.read'],
    pharmacist: ['inventory.vendor.read', 'inventory.purchase.read', 'inventory.purchase.request', 'inventory.indent.read', 'inventory.indent.create'],
    nurse: ['inventory.indent.read', 'inventory.indent.create'],
  },
});

// ---------- helpers ----------

const text = (max: number, label = 'this field') =>
  z
    .string({ error: `Enter ${label}` })
    .trim()
    .min(1, `Enter ${label}`)
    .max(max, `Enter at most ${max} characters`);
const optText = (max: number) => z.string().trim().max(max, `Enter at most ${max} characters`).optional();
const qty = quantity(1, 1_000_000);
const money = moneyField(10_000_000);
/** A date from today up to a year ahead. */
const upcomingDate = (label: string) => todayOrFutureDate(label).refine((d) => d <= todayIso(366), `${label} cannot be more than a year ahead`);
const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
};
export type PageQuery = { page?: number; pageSize?: number };


// ---------- vendors ----------

const vendorBaseSchema = z.object({
  code: z
    .string({ error: 'Enter a vendor code' })
    .trim()
    .min(1, 'Enter a vendor code')
    .max(30, 'Vendor code can be at most 30 characters')
    .regex(/^[A-Za-z0-9._/-]+$/, 'Vendor code can have letters, digits and . _ / - only (no spaces)'),
  name: text(200, 'the vendor name'),
  contactPerson: optText(120),
  phone: blankToUndefined(phoneNumber.optional()),
  email: blankToUndefined(emailAddress.optional()),
  gstin: blankToUndefined(gstinNumber.optional()),
  pan: blankToUndefined(panNumber.optional()),
  address: optText(500),
  paymentTermsDays: z
    .number({ error: 'Enter payment terms in days' })
    .int('Payment terms must be whole days')
    .min(0, 'Payment terms cannot be negative')
    .max(365, 'Payment terms can be at most 365 days')
    .default(30),
  notes: optText(500),
});
/** A GSTIN carries the holder's PAN in characters 3 to 12. */
const panMatchesGstin = (v: { gstin?: string; pan?: string }) => !v.gstin || !v.pan || v.gstin.slice(2, 12) === v.pan;
const PAN_GSTIN_MISMATCH = { message: 'PAN does not match the GSTIN (characters 3 to 12 of the GSTIN are the PAN)', path: ['pan'] };
export const createVendorSchema = vendorBaseSchema.refine(panMatchesGstin, PAN_GSTIN_MISMATCH);
export type CreateVendor = z.input<typeof createVendorSchema>;

/** Columns of the vendor import sheet. */
export const VENDOR_IMPORT_COLUMNS: readonly ImportColumn[] = [
  { key: 'code', header: 'Code', type: 'text', required: true, example: 'V-SURGI' },
  { key: 'name', header: 'Name', type: 'text', required: true, example: 'Surgi Supplies Pvt Ltd' },
  { key: 'contactPerson', header: 'Contact person', type: 'text', example: 'Ravi Kumar' },
  { key: 'phone', header: 'Phone', type: 'text', example: '9876543210' },
  { key: 'email', header: 'Email', type: 'text', example: 'orders@surgi.example' },
  { key: 'gstin', header: 'GSTIN', type: 'text', example: '07AABCS1429B1ZB' },
  { key: 'pan', header: 'PAN', type: 'text', example: 'AABCS1429B' },
  { key: 'address', header: 'Address', type: 'text', example: 'Okhla Phase 2, New Delhi' },
  { key: 'paymentTermsDays', header: 'Payment terms (days)', type: 'integer', example: 30 },
  { key: 'notes', header: 'Notes', type: 'text', example: '' },
];

/** Empty string clears an optional contact field on edit; anything else must still be valid. No defaults (patchSchema). */
export const updateVendorSchema = patchSchema(vendorBaseSchema.omit({ code: true }))
  .extend({
    phone: z.literal('').or(phoneNumber).optional(),
    email: z.literal('').or(emailAddress).optional(),
    gstin: z.literal('').or(gstinNumber).optional(),
    pan: z.literal('').or(panNumber).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(panMatchesGstin, PAN_GSTIN_MISMATCH);
export type UpdateVendor = z.input<typeof updateVendorSchema>;

export const vendorQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  includeInactive: z.stringbool().default(false),
  ...pageQuery,
});
export type VendorQuery = PageQuery & { q?: string; includeInactive?: boolean };

export interface Vendor {
  id: string;
  code: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  paymentTermsDays: number;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
}

// ---------- purchase requisitions ----------

export const REQUISITION_STATUSES = ['submitted', 'approved', 'rejected', 'ordered', 'cancelled'] as const;
export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];

export const createRequisitionSchema = z.object({
  storeId: z.uuid({ error: 'Pick a store' }),
  neededBy: blankToUndefined(upcomingDate('Needed-by date').optional()),
  notes: optText(500),
  lines: z
    .array(z.object({ itemId: z.uuid({ error: 'Pick an item' }), qty, note: optText(200) }))
    .min(1, 'Add at least one item')
    .max(200, 'At most 200 items per requisition')
    .refine(uniqueBy((l: { itemId: string }) => l.itemId), 'The same item is listed twice; combine the quantities into one line'),
});
export type CreateRequisition = z.input<typeof createRequisitionSchema>;

/** Only submitted (undecided) requisitions can be edited; the lines replace the old ones. */
export const updateRequisitionSchema = patchSchema(createRequisitionSchema.omit({ storeId: true }).extend({ neededBy: isoDate.nullable() }));
export type UpdateRequisition = z.input<typeof updateRequisitionSchema>;

export const decisionSchema = z.object({
  approve: z.boolean(),
  note: optText(300),
});
export type Decision = z.input<typeof decisionSchema>;

export const requisitionQuerySchema = z.object({
  status: z.enum(REQUISITION_STATUSES).optional(),
  ...pageQuery,
});
export type RequisitionQuery = PageQuery & { status?: RequisitionStatus };

export interface RequisitionLine {
  id: string;
  lineNo: number;
  itemId: string;
  itemCode: string;
  itemName: string;
  unit: string;
  qty: number;
  note: string | null;
}

export interface Requisition {
  id: string;
  number: string;
  facilityId: string;
  storeId: string;
  storeName: string;
  status: RequisitionStatus;
  neededBy: string | null;
  notes: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  lines?: RequisitionLine[];
}

// ---------- purchase orders ----------

export const PO_STATUSES = ['draft', 'approved', 'partially_received', 'received', 'closed', 'cancelled'] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

/** True when no two entries share a key. */
function uniqueBy<T>(key: (v: T) => string) {
  return (rows: T[]) => new Set(rows.map(key)).size === rows.length;
}

const poLine = z.object({
  itemId: z.uuid({ error: 'Pick an item' }),
  qty,
  /** Per unit, before GST. */
  rate: money,
  /** Defaults to the item's GST rate. */
  gstRate: z
    .number({ error: 'Enter the GST %' })
    .min(0, 'GST cannot be negative')
    .max(40, 'GST cannot be more than 40%')
    .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'GST % can have at most 2 decimals')
    .optional(),
});
const poLines = z
  .array(poLine)
  .min(1, 'Add at least one item')
  .max(200, 'At most 200 items per purchase order')
  .refine(uniqueBy((l: { itemId: string }) => l.itemId), 'The same item is listed twice; combine the quantities into one line');

export const createPurchaseOrderSchema = z.object({
  vendorId: z.uuid({ error: 'Pick a vendor' }),
  /** Delivery store. */
  storeId: z.uuid({ error: 'Pick a delivery store' }),
  /** Marks this approved requisition as ordered. */
  requisitionId: z.uuid().optional(),
  expectedDate: blankToUndefined(upcomingDate('Expected delivery date').optional()),
  terms: optText(1000),
  notes: optText(500),
  lines: poLines,
});
export type CreatePurchaseOrder = z.input<typeof createPurchaseOrderSchema>;

/**
 * Only drafts can be edited; the lines replace the old ones. The expected date is checked against
 * today by the API only when it changes, so an older draft can still be saved as it was. null clears it.
 */
export const updatePurchaseOrderSchema = patchSchema(
  z.object({
    vendorId: z.uuid({ error: 'Pick a vendor' }),
    expectedDate: blankToUndefined(isoDate.nullable().optional()),
    terms: optText(1000),
    notes: optText(500),
    lines: poLines,
  }),
);
export type UpdatePurchaseOrder = z.input<typeof updatePurchaseOrderSchema>;

export const closePurchaseOrderSchema = z.object({ reason: text(300, 'a reason') });
export type ClosePurchaseOrder = z.input<typeof closePurchaseOrderSchema>;

export const purchaseOrderQuerySchema = z.object({
  status: z.enum(PO_STATUSES).optional(),
  vendorId: z.uuid().optional(),
  /** Only POs that can still be received (approved or partially received). */
  open: z.stringbool().default(false),
  q: z.string().trim().max(60).optional(),
  ...pageQuery,
});
export type PurchaseOrderQuery = PageQuery & { status?: PoStatus; vendorId?: string; open?: boolean; q?: string };

export interface PurchaseOrderLine {
  id: string;
  lineNo: number;
  itemId: string;
  itemCode: string;
  itemName: string;
  unit: string;
  qty: number;
  receivedQty: number;
  pendingQty: number;
  rate: number;
  gstRate: number;
  taxAmount: number;
  amount: number;
}

export interface PurchaseOrder {
  id: string;
  number: string;
  facilityId: string;
  storeId: string;
  storeName: string;
  vendorId: string;
  vendorName: string;
  requisitionId: string | null;
  status: PoStatus;
  expectedDate: string | null;
  terms: string | null;
  notes: string | null;
  subtotal: number;
  taxTotal: number;
  total: number;
  approvedAt: string | null;
  closedReason: string | null;
  createdAt: string;
  lines?: PurchaseOrderLine[];
}

// ---------- goods receipt against a PO ----------

export const createGrnSchema = z.object({
  purchaseOrderId: z.uuid({ error: 'Pick a purchase order' }),
  invoiceNo: optText(60),
  invoiceDate: blankToUndefined(
    pastOrTodayDate('Invoice date')
      .refine((d) => d >= todayIso(-730), 'Invoice date cannot be more than 2 years ago')
      .optional(),
  ),
  notes: optText(500),
  lines: z
    .array(
      z.object({
        poLineId: z.uuid(),
        qty,
        freeQty: quantity(0, 1_000_000).default(0),
        /** Consumables without batches can leave these out ("NA", no expiry). */
        batchNo: blankToUndefined(
          z
            .string()
            .trim()
            .max(40, 'Batch number can be at most 40 characters')
            .regex(/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/, 'Batch number can have letters, digits and . _ / - only')
            .optional(),
        ),
        /** Must not be in the past: expired stock cannot be received. */
        expiryDate: blankToUndefined(expiryDate.refine((d) => d > todayIso(), 'This batch has already expired; expired stock cannot be received').optional()),
        /** Defaults to the PO rate plus GST. */
        mrp: money.refine((v) => v > 0, 'MRP must be more than 0').optional(),
      }),
    )
    .min(1, 'Add at least one item')
    .max(200),
});
export type CreateGrn = z.input<typeof createGrnSchema>;

export interface GrnLine {
  id: string;
  poLineId: string;
  itemId: string;
  itemName: string;
  batchId: string;
  batchNo: string;
  expiryDate: string;
  qty: number;
  freeQty: number;
  returnedQty: number;
  rate: number;
  gstRate: number;
  mrp: number;
  amount: number;
}

export interface Grn {
  id: string;
  number: string;
  purchaseOrderId: string;
  poNumber?: string;
  storeId: string;
  vendorId: string;
  vendorName: string;
  invoiceNo: string | null;
  invoiceDate: string | null;
  total: number;
  notes: string | null;
  createdAt: string;
  lines?: GrnLine[];
  returns?: PurchaseReturn[];
}

export const grnQuerySchema = z.object({ purchaseOrderId: z.uuid().optional(), ...pageQuery });
export type GrnQuery = PageQuery & { purchaseOrderId?: string };

// ---------- purchase returns ----------

export const createPurchaseReturnSchema = z.object({
  reason: text(300, 'a reason for the return'),
  lines: z
    .array(z.object({ grnLineId: z.uuid(), qty }))
    .min(1, 'Add at least one item to return')
    .max(200),
});
export type CreatePurchaseReturn = z.input<typeof createPurchaseReturnSchema>;

export interface PurchaseReturn {
  id: string;
  number: string;
  grnId: string;
  storeId: string;
  vendorId: string;
  reason: string;
  total: number;
  createdAt: string;
  lines: { id: string; grnLineId: string; itemId: string; batchId: string; qty: number; amount: number }[];
}

// ---------- indents and issues ----------

export const INDENT_STATUSES = ['submitted', 'approved', 'partially_issued', 'issued', 'rejected', 'cancelled', 'closed'] as const;
export type IndentStatus = (typeof INDENT_STATUSES)[number];

export const createIndentSchema = z.object({
  /** The store that needs the goods (ward, OT, pharmacy). */
  toStoreId: z.uuid({ error: 'Pick the store that needs the goods' }),
  /** The store that supplies them (usually the main store). */
  fromStoreId: z.uuid({ error: 'Pick the store to supply from' }),
  priority: z.enum(['normal', 'urgent']).default('normal'),
  notes: optText(500),
  lines: z
    .array(z.object({ itemId: z.uuid({ error: 'Pick an item' }), qty, note: optText(200) }))
    .min(1, 'Add at least one item')
    .max(200, 'At most 200 items per indent')
    .refine(uniqueBy((l: { itemId: string }) => l.itemId), 'The same item is listed twice; combine the quantities into one line'),
});
export type CreateIndent = z.input<typeof createIndentSchema>;

/** Only submitted (undecided) indents can be edited; the stores stay, the lines replace the old ones. */
export const updateIndentSchema = patchSchema(createIndentSchema.omit({ toStoreId: true, fromStoreId: true }));
export type UpdateIndent = z.input<typeof updateIndentSchema>;

export const decideIndentSchema = z.object({
  approve: z.boolean(),
  note: optText(300),
  /** Approve less than asked for on some lines. Lines left out are approved in full. */
  lines: z.array(z.object({ indentLineId: z.uuid(), approvedQty: quantity(0, 1_000_000) })).max(200).optional(),
});
export type DecideIndent = z.input<typeof decideIndentSchema>;

export const issueIndentSchema = z.object({
  notes: optText(500),
  /**
   * Issued for a patient (consumables used on them). With an admission the charges join the IPD bill; a patient
   * alone is looked up for a current admission. Charged per the hospital's billing rule `consumables`.
   */
  patientId: z.uuid().optional(),
  admissionId: z.uuid().optional(),
  /** Picks batches first-expiry-first-out unless batchId is given. */
  lines: z
    .array(z.object({ indentLineId: z.uuid(), qty, batchId: z.uuid().optional() }))
    .min(1)
    .max(200),
});
export type IssueIndent = z.input<typeof issueIndentSchema>;

export const closeIndentSchema = z.object({ reason: text(300, 'a reason') });
export type CloseIndent = z.input<typeof closeIndentSchema>;

export const indentQuerySchema = z.object({
  status: z.enum(INDENT_STATUSES).optional(),
  /** Indents waiting for the store to act (approved or partially issued). */
  pending: z.stringbool().default(false),
  storeId: z.uuid().optional(),
  ...pageQuery,
});
export type IndentQuery = PageQuery & { status?: IndentStatus; pending?: boolean; storeId?: string };

export interface IndentLine {
  id: string;
  lineNo: number;
  itemId: string;
  itemCode: string;
  itemName: string;
  unit: string;
  requestedQty: number;
  approvedQty: number | null;
  issuedQty: number;
  pendingQty: number;
  note: string | null;
}

export interface IssueLine {
  id: string;
  indentLineId: string;
  itemId: string;
  batchId: string;
  batchNo: string;
  expiryDate: string;
  qty: number;
}

export interface Issue {
  id: string;
  number: string;
  indentId: string;
  fromStoreId: string;
  toStoreId: string;
  notes: string | null;
  /** Set when the goods were issued for a patient / IPD admission. */
  patientId: string | null;
  admissionId: string | null;
  patientName: string | null;
  createdAt: string;
  lines: IssueLine[];
}

export interface Indent {
  id: string;
  number: string;
  facilityId: string;
  toStoreId: string;
  toStoreName: string;
  fromStoreId: string;
  fromStoreName: string;
  priority: 'normal' | 'urgent';
  status: IndentStatus;
  notes: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  lines?: IndentLine[];
  issues?: Issue[];
}

// ---------- events (published by inventory) ----------

/** `inventory.po.approved` */
export interface InventoryPoApprovedEvent {
  purchaseOrderId: string;
  number: string;
  vendorId: string;
  storeId: string;
  total: number;
}

/** `inventory.grn.posted` */
export interface InventoryGrnPostedEvent {
  grnId: string;
  number: string;
  purchaseOrderId: string;
  vendorId: string;
  storeId: string;
  invoiceNo: string | null;
  total: number;
}

/** `inventory.indent.issued` */
export interface InventoryIndentIssuedEvent {
  indentId: string;
  issueId: string;
  fromStoreId: string;
  toStoreId: string;
  patientId?: string | null;
  admissionId?: string | null;
  /** The issued lines were charged to the patient account (billing rule consumables = 'charge'). */
  chargedToPatient?: boolean;
  lines: { itemId: string; batchId: string; qty: number }[];
}
