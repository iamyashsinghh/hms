import { z } from 'zod';
import { defineModule } from '../manifest';
import { patchSchema } from '../patch';

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

const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).optional();
const qty = z.number().int().min(1).max(1_000_000);
const money = z.number().min(0).max(10_000_000);
const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
};
export type PageQuery = { page?: number; pageSize?: number };

export const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_REGEX = /^[A-Z]{5}\d{4}[A-Z]$/;

// ---------- vendors ----------

export const createVendorSchema = z.object({
  code: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9._/-]+$/, 'Letters, digits and . _ / - only'),
  name: text(200),
  contactPerson: optText(120),
  phone: z.string().trim().regex(/^[0-9+\- ]{6,20}$/, 'Invalid phone number').optional(),
  email: z.email().optional(),
  gstin: z.string().trim().toUpperCase().regex(GSTIN_REGEX, 'Invalid GSTIN').optional(),
  pan: z.string().trim().toUpperCase().regex(PAN_REGEX, 'Invalid PAN').optional(),
  address: optText(500),
  paymentTermsDays: z.number().int().min(0).max(365).default(30),
  notes: optText(500),
});
export type CreateVendor = z.input<typeof createVendorSchema>;

/** Empty string clears an optional contact field on edit. */
export const updateVendorSchema = patchSchema(createVendorSchema.omit({ code: true })).extend({
  phone: createVendorSchema.shape.phone.or(z.literal('')),
  email: createVendorSchema.shape.email.or(z.literal('')),
  gstin: createVendorSchema.shape.gstin.or(z.literal('')),
  pan: createVendorSchema.shape.pan.or(z.literal('')),
  isActive: z.boolean().optional(),
});
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
  storeId: z.uuid(),
  neededBy: z.iso.date().optional(),
  notes: optText(500),
  lines: z
    .array(z.object({ itemId: z.uuid(), qty, note: optText(200) }))
    .min(1)
    .max(200),
});
export type CreateRequisition = z.input<typeof createRequisitionSchema>;

/** Only submitted (undecided) requisitions can be edited; the lines replace the old ones. */
export const updateRequisitionSchema = patchSchema(createRequisitionSchema.omit({ storeId: true }).extend({ neededBy: z.iso.date().nullable() }));
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

const poLine = z.object({
  itemId: z.uuid(),
  qty,
  /** Per unit, before GST. */
  rate: money,
  /** Defaults to the item's GST rate. */
  gstRate: z.number().min(0).max(40).optional(),
});

export const createPurchaseOrderSchema = z.object({
  vendorId: z.uuid(),
  /** Delivery store. */
  storeId: z.uuid(),
  /** Marks this approved requisition as ordered. */
  requisitionId: z.uuid().optional(),
  expectedDate: z.iso.date().optional(),
  terms: optText(1000),
  notes: optText(500),
  lines: z.array(poLine).min(1).max(200),
});
export type CreatePurchaseOrder = z.input<typeof createPurchaseOrderSchema>;

/** Only drafts can be edited; the lines replace the old ones. */
export const updatePurchaseOrderSchema = patchSchema(createPurchaseOrderSchema.omit({ storeId: true, requisitionId: true }).extend({ expectedDate: z.iso.date().nullable() }));
export type UpdatePurchaseOrder = z.input<typeof updatePurchaseOrderSchema>;

export const closePurchaseOrderSchema = z.object({ reason: text(300) });
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
  purchaseOrderId: z.uuid(),
  invoiceNo: optText(60),
  invoiceDate: z.iso.date().optional(),
  notes: optText(500),
  lines: z
    .array(
      z.object({
        poLineId: z.uuid(),
        qty,
        freeQty: z.number().int().min(0).max(1_000_000).default(0),
        /** Consumables without batches can leave these out ("NA", no expiry). */
        batchNo: z.string().trim().min(1).max(40).optional(),
        expiryDate: z.iso.date().optional(),
        /** Defaults to the PO rate plus GST. */
        mrp: money.optional(),
      }),
    )
    .min(1)
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
  reason: text(300),
  lines: z
    .array(z.object({ grnLineId: z.uuid(), qty }))
    .min(1)
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
  toStoreId: z.uuid(),
  /** The store that supplies them (usually the main store). */
  fromStoreId: z.uuid(),
  priority: z.enum(['normal', 'urgent']).default('normal'),
  notes: optText(500),
  lines: z
    .array(z.object({ itemId: z.uuid(), qty, note: optText(200) }))
    .min(1)
    .max(200),
});
export type CreateIndent = z.input<typeof createIndentSchema>;

/** Only submitted (undecided) indents can be edited; the stores stay, the lines replace the old ones. */
export const updateIndentSchema = patchSchema(createIndentSchema.omit({ toStoreId: true, fromStoreId: true }));
export type UpdateIndent = z.input<typeof updateIndentSchema>;

export const decideIndentSchema = z.object({
  approve: z.boolean(),
  note: optText(300),
  /** Approve less than asked for on some lines. Lines left out are approved in full. */
  lines: z.array(z.object({ indentLineId: z.uuid(), approvedQty: z.number().int().min(0).max(1_000_000) })).max(200).optional(),
});
export type DecideIndent = z.input<typeof decideIndentSchema>;

export const issueIndentSchema = z.object({
  notes: optText(500),
  /** Picks batches first-expiry-first-out unless batchId is given. */
  lines: z
    .array(z.object({ indentLineId: z.uuid(), qty, batchId: z.uuid().optional() }))
    .min(1)
    .max(200),
});
export type IssueIndent = z.input<typeof issueIndentSchema>;

export const closeIndentSchema = z.object({ reason: text(300) });
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
  lines: { itemId: string; batchId: string; qty: number }[];
}
