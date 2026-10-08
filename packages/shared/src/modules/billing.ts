import { z } from 'zod';
import { defineModule } from '../manifest';
import { blankToUndefined, datesInOrder, END_BEFORE_START, gstin as strictGstin, hsnCode, isoDate, phoneNumber, requiredText } from '../validation';
import { patchSchema } from '../patch';
import type { ImportColumn } from '../imports';

/**
 * Billing: permissions and API contracts (Zod schemas + types).
 * Owned by the "billing" workstream. Money travels as numbers in rupees with 2 decimals.
 */
export const billingModule = defineModule({
  key: 'billing',
  name: 'Billing',
  permissions: [
    { key: 'billing.service.read', description: 'View services, packages and price lists' },
    { key: 'billing.service.manage', description: 'Create and edit services, packages and price lists' },
    { key: 'billing.settings.manage', description: 'Edit billing settings (GSTIN, UPI, invoice footer)' },
    { key: 'billing.invoice.read', description: 'View invoices, receipts and patient balances' },
    { key: 'billing.invoice.create', description: 'Create and edit draft invoices' },
    { key: 'billing.invoice.finalize', description: 'Finalize invoices (assigns the invoice number)' },
    { key: 'billing.invoice.cancel', description: 'Cancel unpaid final invoices' },
    { key: 'billing.payment.collect', description: 'Collect payments and advance deposits' },
    { key: 'billing.payment.refund', description: 'Refund payments and deposits' },
    { key: 'billing.creditnote.create', description: 'Issue credit notes against final invoices' },
    { key: 'billing.shift.manage', description: 'Open and close own cash shift' },
    { key: 'billing.shift.read', description: "View every cashier's shifts and collections" },
    { key: 'billing.discount.override', description: 'Give discounts above the billing rules limit' },
    { key: 'billing.price.override', description: 'Change the price on a charge or bill line' },
  ],
  grants: {
    hospital_admin: [
      'billing.service.read', 'billing.service.manage', 'billing.settings.manage', 'billing.invoice.read',
      'billing.invoice.create', 'billing.invoice.finalize', 'billing.invoice.cancel', 'billing.payment.collect',
      'billing.payment.refund', 'billing.creditnote.create', 'billing.shift.manage', 'billing.shift.read',
      'billing.discount.override', 'billing.price.override',
    ],
    owner: ['billing.service.read', 'billing.invoice.read', 'billing.shift.read'],
    accountant: [
      'billing.service.read', 'billing.service.manage', 'billing.invoice.read', 'billing.invoice.cancel',
      'billing.payment.refund', 'billing.creditnote.create', 'billing.shift.read', 'billing.discount.override',
      'billing.price.override',
    ],
    billing_clerk: [
      'billing.service.read', 'billing.invoice.read', 'billing.invoice.create', 'billing.invoice.finalize',
      'billing.payment.collect', 'billing.shift.manage',
    ],
    receptionist: [
      'billing.service.read', 'billing.invoice.read', 'billing.invoice.create', 'billing.invoice.finalize',
      'billing.payment.collect', 'billing.shift.manage',
    ],
    pharmacist: ['billing.service.read', 'billing.invoice.read', 'billing.payment.collect', 'billing.shift.manage'],
    doctor: ['billing.service.read'],
  },
});

// ---------- shared bits ----------

const money = z.coerce
  .number({ error: 'Enter an amount' })
  .refine(Number.isFinite, 'Enter an amount')
  .min(0, 'Amount cannot be negative')
  .max(99_999_999_999.99)
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'At most 2 decimal places');
const positiveMoney = money.refine((v) => v > 0, 'Must be more than 0');
const optionalText = (max: number) => z.string().trim().max(max, `Can be at most ${max} characters`).optional();
const gstin = strictGstin;
/** A reason someone must type (refunds, cancellations, credit notes). */
const reasonText = (what = 'a reason') => z.string({ error: `Enter ${what}` }).trim().min(3, `Enter ${what} (at least 3 characters)`).max(500, 'Reason can be at most 500 characters');
const dateRange = <T extends { from?: string; to?: string }>(v: T) => datesInOrder(v.from, v.to);

export const GST_RATES = [0, 0.1, 0.25, 3, 5, 12, 18, 28, 40] as const;
export const SERVICE_CATEGORIES = ['consultation', 'procedure', 'lab', 'radiology', 'room', 'nursing', 'pharmacy', 'package', 'other'] as const;
export const INVOICE_STATUSES = ['draft', 'final', 'cancelled'] as const;
export const PAYMENT_MODES = ['cash', 'upi', 'card', 'bank', 'cheque'] as const;
/** 'deposit' adjusts the patient's advance against an invoice. */
export const SETTLEMENT_MODES = [...PAYMENT_MODES, 'deposit'] as const;
export const PAYMENT_KINDS = ['payment', 'deposit', 'refund'] as const;

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export type SettlementMode = (typeof SETTLEMENT_MODES)[number];
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
/** Modes that can appear on a receipt: staff-entered modes plus 'online' (payment gateway via the patient portal). */
export type ReceiptMode = SettlementMode | 'online' | 'insurance';
export const RECEIPT_MODES = [...SETTLEMENT_MODES, 'online', 'insurance'] as const;
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

const taxRate = z.coerce.number().refine((v) => (GST_RATES as readonly number[]).includes(v), 'Use a GST slab: 0, 0.1, 0.25, 3, 5, 12, 18, 28 or 40');

// ---------- settings ----------

export const billingSettingsInputSchema = z.object({
  legalName: optionalText(200),
  /** Empty string clears a field. */
  gstin: z.union([gstin, z.literal('')]).optional(),
  stateCode: z.union([z.string().regex(/^\d{2}$/, 'Two-digit GST state code'), z.literal('')]).optional(),
  address: optionalText(500),
  phone: z.union([phoneNumber, z.literal('')]).optional(),
  upiVpa: z.union([z.string().trim().regex(/^[\w.-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/, 'Enter a UPI ID like hospital@okbank'), z.literal('')]).optional(),
  upiPayeeName: optionalText(100),
  invoiceFooter: optionalText(1000),
  roundOff: z.boolean().optional(),
}).refine((v) => !v.gstin || !v.stateCode || v.gstin.slice(0, 2) === v.stateCode, {
  message: 'State code must match the first two digits of the GSTIN',
  path: ['stateCode'],
});
export type BillingSettingsInput = z.input<typeof billingSettingsInputSchema>;

export interface BillingSettings {
  legalName: string | null;
  gstin: string | null;
  stateCode: string | null;
  address: string | null;
  phone: string | null;
  upiVpa: string | null;
  upiPayeeName: string | null;
  invoiceFooter: string | null;
  roundOff: boolean;
}

// ---------- services ----------

export const createServiceSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_.-]{0,39}$/, 'Letters, digits, - _ . (max 40)'),
  name: requiredText('the service name', 200),
  category: z.enum(SERVICE_CATEGORIES).default('other'),
  departmentId: z.uuid().optional(),
  hsnSac: blankToUndefined(z.string().trim().regex(/^\d{4,8}$/, '4–8 digit HSN/SAC').optional()),
  basePrice: money,
  taxRate: taxRate.default(0),
  isActive: z.boolean().default(true),
  /** Only for category 'package': services included. */
  packageItems: z
    .array(z.object({ serviceId: z.uuid(), qty: z.coerce.number().positive('Quantity must be more than 0').max(1000, 'Quantity cannot be more than 1000').default(1) }))
    .max(100)
    .optional(),
});
export type CreateService = z.input<typeof createServiceSchema>;

/** No defaults (patchSchema, not .partial()): Zod 4 keeps defaults inside .partial(), so a PATCH would reset the category, GST or active flag it did not send. */
export const updateServiceSchema = patchSchema(createServiceSchema.omit({ code: true }));
export type UpdateService = z.input<typeof updateServiceSchema>;

/** Columns of the service / price master import sheet. Packages are built on the form (they need their items). */
export const SERVICE_IMPORT_COLUMNS: readonly ImportColumn[] = [
  { key: 'code', header: 'Code', type: 'text', required: true, example: 'CONS-GEN' },
  { key: 'name', header: 'Name', type: 'text', required: true, example: 'General consultation' },
  { key: 'category', header: 'Category', type: 'enum', options: SERVICE_CATEGORIES.filter((c) => c !== 'package'), example: 'consultation' },
  { key: 'hsnSac', header: 'HSN/SAC', type: 'text', example: '999312' },
  { key: 'basePrice', header: 'Price', type: 'number', required: true, example: 500 },
  { key: 'taxRate', header: 'GST %', type: 'enum', options: GST_RATES, example: 0 },
  { key: 'isActive', header: 'Active', type: 'boolean', example: 'Yes' },
];
export const serviceImportRowSchema = createServiceSchema
  .omit({ departmentId: true, packageItems: true })
  .refine((r) => r.category !== 'package', { path: ['category'], message: 'Create packages on the service form' });
export type ServiceImportRow = z.output<typeof serviceImportRowSchema>;

export interface Service {
  id: string;
  code: string;
  name: string;
  category: ServiceCategory;
  departmentId: string | null;
  hsnSac: string | null;
  basePrice: number;
  taxRate: number;
  isActive: boolean;
  packageItems?: { serviceId: string; code: string; name: string; qty: number }[];
  createdAt: string;
  updatedAt: string;
}

export const serviceQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.enum(SERVICE_CATEGORIES).optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ServiceQuery = { q?: string; category?: ServiceCategory; active?: 'true' | 'false' | 'all'; page?: number; pageSize?: number };

// ---------- price lists ----------

export const priceListInputSchema = z
  .object({
    name: requiredText('a name', 200),
    payerId: z.uuid().nullable().optional(),
    effectiveFrom: isoDate,
    effectiveTo: isoDate.nullable().optional(),
    isActive: z.boolean().default(true),
    items: z.array(z.object({ serviceId: z.uuid(), price: money })).max(5000).default([]),
  })
  .refine((v) => datesInOrder(v.effectiveFrom, v.effectiveTo), { message: END_BEFORE_START, path: ['effectiveTo'] });
export type PriceListInput = z.input<typeof priceListInputSchema>;

export interface PriceList {
  id: string;
  name: string;
  payerId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  items: { serviceId: string; code: string; name: string; price: number }[];
}

export interface ServicePrice {
  serviceId: string;
  serviceCode: string;
  name: string;
  price: number;
  taxRate: number;
  hsnSac: string | null;
  /** Price list the price came from; null = the service's base price. */
  priceListId: string | null;
}

// ---------- invoices ----------

export const invoiceLineInputSchema = z
  .object({
    /** Charge engine: price, tax rate, HSN/SAC and description come from the service master when omitted. */
    serviceCode: z.string().trim().toUpperCase().max(40).optional(),
    /** Pharmacy item id (inventory module). */
    itemId: z.uuid().optional(),
    description: z.string().trim().min(1).max(300, 'Description can be at most 300 characters').optional(),
    hsnSac: blankToUndefined(hsnCode.optional()),
    qty: z.coerce.number({ error: 'Enter a quantity' }).positive('Quantity must be more than 0').max(100000, 'Quantity cannot be more than 1,00,000').default(1),
    unitPrice: money.optional(),
    taxRate: taxRate.optional(),
    /** Discount amount in rupees for the whole line. */
    discount: money.optional(),
    /** True when unitPrice already includes GST (e.g. drug MRP). */
    priceIncludesTax: z.boolean().optional(),
  })
  .refine((l) => l.serviceCode || (l.description && l.unitPrice !== undefined), {
    message: 'Give a service code, or a description and a price',
  })
  .refine((l) => l.discount === undefined || l.unitPrice === undefined || l.discount <= Math.round(l.qty * l.unitPrice * 100) / 100 + 1e-9, {
    message: 'Discount is more than the line amount',
    path: ['discount'],
  });
export type InvoiceLineInput = z.input<typeof invoiceLineInputSchema>;

export const payNowSchema = z.object({
  mode: z.enum(SETTLEMENT_MODES),
  amount: positiveMoney,
  ref: optionalText(100),
});
export type PayNow = z.input<typeof payNowSchema>;

export const createInvoiceSchema = z.object({
  patientId: z.uuid(),
  /** Defaults to the facility in the request (X-Facility-Id). */
  facilityId: z.uuid().optional(),
  source: z.object({ module: z.string().min(1).max(40), refId: z.string().max(100).optional() }).optional(),
  payerId: z.uuid().optional(),
  /** Treating / consulting doctor (staff user id), for doctor-wise revenue. */
  doctorId: z.uuid().optional(),
  supplyType: z.enum(['intra', 'inter']).default('intra'),
  buyerGstin: gstin.optional(),
  notes: optionalText(1000),
  lines: z.array(invoiceLineInputSchema).min(1).max(500),
  /** Finalize straight away (default true when called by another module; the web creates drafts). */
  finalize: z.boolean().optional(),
  payNow: payNowSchema.optional(),
});
export type CreateInvoice = z.input<typeof createInvoiceSchema>;

export const updateInvoiceSchema = patchSchema(
  createInvoiceSchema
    .pick({ supplyType: true, buyerGstin: true, notes: true, payerId: true, doctorId: true })
    .extend({ lines: z.array(invoiceLineInputSchema).min(1).max(500) }),
);
export type UpdateInvoice = z.input<typeof updateInvoiceSchema>;

export const cancelInvoiceSchema = z.object({ reason: reasonText('the reason for cancelling') });
export type CancelInvoice = z.input<typeof cancelInvoiceSchema>;

export const invoiceQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  patientId: z.uuid().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  paymentStatus: z.enum(['unpaid', 'partial', 'paid']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
}).refine(dateRange, { message: END_BEFORE_START, path: ['to'] });
export type InvoiceQuery = {
  q?: string;
  patientId?: string;
  status?: InvoiceStatus;
  paymentStatus?: PaymentStatus;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

export interface InvoiceLine {
  id: string;
  lineNo: number;
  serviceId: string | null;
  serviceCode: string | null;
  itemId: string | null;
  description: string;
  hsnSac: string | null;
  qty: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxableAmount: number;
  taxAmount: number;
  total: number;
}

export interface InvoiceSummary {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  paymentStatus: PaymentStatus;
  invoiceDate: string;
  facilityId: string;
  patientId: string;
  patientName: string;
  patientUhid: string;
  sourceModule: string;
  total: number;
  paidAmount: number;
  creditedAmount: number;
  balance: number;
  createdAt: string;
}

export interface Invoice extends InvoiceSummary {
  patientMobile: string | null;
  sourceRef: string | null;
  payerId: string | null;
  doctorId: string | null;
  supplyType: 'intra' | 'inter';
  buyerGstin: string | null;
  sellerName: string | null;
  sellerGstin: string | null;
  subtotal: number;
  discountTotal: number;
  taxableTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  taxTotal: number;
  roundOff: number;
  notes: string | null;
  finalizedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  lines: InvoiceLine[];
  payments: Payment[];
  creditNotes: CreditNote[];
  /** `upi://pay?...` link for the QR code on the bill, when a UPI ID is set and money is due. */
  upiLink: string | null;
}

/** Result of BillingService.createInvoice (agreed cross-module contract). */
export interface CreatedInvoice {
  invoiceId: string;
  number: string | null;
  total: number;
  status: InvoiceStatus;
}

// ---------- payments, deposits, refunds ----------

export const collectPaymentSchema = z.object({
  mode: z.enum(SETTLEMENT_MODES),
  amount: positiveMoney,
  reference: optionalText(100),
  notes: optionalText(500),
});
export type CollectPayment = z.input<typeof collectPaymentSchema>;

export const depositSchema = z.object({
  patientId: z.uuid(),
  facilityId: z.uuid().optional(),
  mode: z.enum(PAYMENT_MODES),
  amount: positiveMoney,
  reference: optionalText(100),
  notes: optionalText(500),
});
export type DepositInput = z.input<typeof depositSchema>;

export const refundSchema = z
  .object({
    /** Refund money received against this invoice... */
    invoiceId: z.uuid().optional(),
    /** ...or refund unused advance of this patient. */
    patientId: z.uuid().optional(),
    facilityId: z.uuid().optional(),
    mode: z.enum(PAYMENT_MODES),
    amount: positiveMoney,
    reference: optionalText(100),
    notes: reasonText('the reason for the refund'),
  })
  .refine((r) => !!r.invoiceId !== !!r.patientId, { message: 'Give either an invoice or a patient (for deposit refunds)' });
export type RefundInput = z.input<typeof refundSchema>;

export interface Payment {
  id: string;
  number: string;
  kind: PaymentKind;
  facilityId: string;
  patientId: string;
  invoiceId: string | null;
  mode: ReceiptMode;
  amount: number;
  reference: string | null;
  notes: string | null;
  shiftId: string | null;
  receivedBy: string | null;
  receivedAt: string;
}

export const paymentQuerySchema = z.object({
  patientId: z.uuid().optional(),
  kind: z.enum(PAYMENT_KINDS).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
}).refine(dateRange, { message: END_BEFORE_START, path: ['to'] });
export type PaymentQuery = { patientId?: string; kind?: PaymentKind; from?: string; to?: string; page?: number; pageSize?: number };

export interface PatientAccount {
  patientId: string;
  depositBalance: number;
  outstanding: number;
  invoices: InvoiceSummary[];
  deposits: Payment[];
}

// ---------- credit notes ----------

export const creditNoteSchema = z.object({
  amount: positiveMoney,
  reason: reasonText(),
});
export type CreditNoteInput = z.input<typeof creditNoteSchema>;

/** BillingService.creditNoteTx (cross-module). `reference` makes retries safe. */
export const creditNoteTxSchema = creditNoteSchema.extend({ reference: z.string().trim().min(1).max(100).optional() });
export type CreditNoteTxInput = z.input<typeof creditNoteTxSchema>;

/**
 * BillingService.collectPaymentTx (cross-module, e.g. insurance settlements). Any receipt mode, including
 * 'insurance' (TPA / scheme money, not counted in a cashier's shift). `reference` makes retries safe.
 */
export const collectPaymentTxSchema = z.object({
  mode: z.enum(RECEIPT_MODES),
  amount: positiveMoney,
  reference: z.string().trim().min(1).max(100).optional(),
  notes: optionalText(500),
});
export type CollectPaymentTxInput = z.input<typeof collectPaymentTxSchema>;

/**
 * BillingService.returnOnInvoice (cross-module, e.g. pharmacy returns): credits `amount` against a final
 * invoice. If more than the unpaid balance is credited, the excess is refunded first with `refundMode`.
 */
export const invoiceReturnSchema = z.object({
  amount: positiveMoney,
  reason: z.string().trim().min(3).max(500),
  /** Needed when part of the amount was already paid and must go back to the patient. */
  refundMode: z.enum(PAYMENT_MODES).optional(),
  /** Caller's id for this return (e.g. pharmacy return id). Repeating it returns the first result. */
  reference: z.string().trim().min(1).max(100).optional(),
});
export type InvoiceReturnInput = z.input<typeof invoiceReturnSchema>;

export interface InvoiceReturnResult {
  invoiceId: string;
  creditNoteId: string;
  creditNoteNumber: string;
  refundId: string | null;
  refundNumber: string | null;
  refundAmount: number;
  /** Invoice balance after the return. */
  balance: number;
}

export interface CreditNote {
  id: string;
  number: string;
  invoiceId: string;
  patientId: string;
  amount: number;
  reason: string;
  reference: string | null;
  createdAt: string;
}

// ---------- cash shifts ----------

export const openShiftSchema = z.object({ openingCash: money.default(0), facilityId: z.uuid().optional() });
export type OpenShift = z.input<typeof openShiftSchema>;

export const closeShiftSchema = z.object({ countedCash: money, notes: optionalText(500) });
export type CloseShift = z.input<typeof closeShiftSchema>;

export interface CashShift {
  id: string;
  facilityId: string;
  userId: string;
  userName: string | null;
  status: 'open' | 'closed';
  openedAt: string;
  openingCash: number;
  closedAt: string | null;
  /** Totals by mode for collections minus refunds in this shift (live for an open shift). */
  totals: Record<string, number>;
  expectedCash: number;
  countedCash: number | null;
  difference: number | null;
  notes: string | null;
}

// ---------- events (payload types for subscribers) ----------

export interface InvoiceFinalizedEvent {
  invoiceId: string;
  number: string;
  patientId: string;
  facilityId: string;
  total: number;
  source: { module: string; refId: string | null };
  doctorId: string | null;
  invoiceDate: string;
  lines: { serviceCode: string | null; itemId: string | null; description: string; qty: number; amount: number }[];
  /** Amount already paid at finalization (payNow / earlier receipts). */
  paid: number;
  finalizedAt: string;
}
export interface PaymentReceivedEvent {
  paymentId: string;
  invoiceId: string | null;
  patientId: string;
  amount: number;
  mode: ReceiptMode;
  kind: 'payment' | 'deposit';
  facilityId: string;
  /** Receipt reference; for portal payments this is the payment intent id. */
  ref: string | null;
}

/** `portal.payment.captured` as published by the portal module (billing records it). */
export interface PortalPaymentCaptured {
  intentId: string;
  invoiceId: string;
  patientId: string;
  amount: string | number;
  mode: 'online';
  provider?: string;
  providerPaymentId: string;
}
export interface RefundIssuedEvent {
  paymentId: string;
  invoiceId: string | null;
  patientId: string;
  facilityId: string;
  amount: number;
  mode: PaymentMode;
}
export interface InvoiceCancelledEvent {
  invoiceId: string;
  number: string;
  patientId: string;
}

// =====================================================================
// Charges (patient account) and billing rules
// =====================================================================
//
// Every department posts what a patient owes as a *charge* (BillingService.postCharge, inside the
// caller's transaction). Charges stay pending on the patient's account until the billing desk (or a
// "Collect now" button) turns them into one invoice with BillingService.billCharges. Each hospital
// decides how charges are posted through its billing rules.

export const CHARGE_STATUSES = ['pending', 'billed', 'cancelled'] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];
/** What the charge belongs to, so the bill groups itself. */
export const CHARGE_ACCOUNTS = ['opd', 'ipd', 'other'] as const;
export type ChargeAccount = (typeof CHARGE_ACCOUNTS)[number];

/** Where a charge came from. (module, refId, line) is unique: posting the same source twice returns the first charge. */
export const chargeSourceSchema = z.object({
  module: z.string().trim().min(1).max(40),
  refId: z.string().trim().min(1).max(100),
  /** Distinguishes several charges from one source (e.g. one per test on a lab order). */
  line: z.string().trim().max(100).default(''),
});
export type ChargeSource = z.input<typeof chargeSourceSchema>;

/** BillingService.postCharge (cross-module, inside the caller's transaction). */
export const postChargeSchema = z
  .object({
    patientId: z.uuid(),
    /** Defaults to the facility in the request (X-Facility-Id). */
    facilityId: z.uuid().optional(),
    /** OPD visit (clinical.opd_visits id) the charge belongs to. */
    visitId: z.uuid().optional(),
    /** IPD admission the charge belongs to. */
    admissionId: z.uuid().optional(),
    source: chargeSourceSchema,
    /** Priced from the service master / payer price list when unitPrice or taxRate is omitted. */
    serviceCode: z.string().trim().toUpperCase().max(40).optional(),
    /** Pharmacy / inventory item id. */
    itemId: z.uuid().optional(),
    description: z.string().trim().min(1).max(300, 'Description can be at most 300 characters').optional(),
    hsnSac: blankToUndefined(hsnCode.optional()),
    qty: z.coerce.number({ error: 'Enter a quantity' }).positive('Quantity must be more than 0').max(100000).default(1),
    unitPrice: money.optional(),
    taxRate: taxRate.optional(),
    priceIncludesTax: z.boolean().optional(),
    discount: money.optional(),
    doctorId: z.uuid().optional(),
    /** Business date of the service; defaults to today (India time). */
    chargeDate: isoDate.optional(),
    notes: optionalText(300),
  })
  .refine((c) => c.serviceCode || (c.description && c.unitPrice !== undefined), {
    message: 'Give a service code, or a description and a price',
  });
export type PostChargeInput = z.input<typeof postChargeSchema>;

/** POST /billing/charges: a manual charge added to a patient's account from the billing desk or IPD. */
export const manualChargeSchema = z
  .object({
    patientId: z.uuid(),
    visitId: z.uuid().optional(),
    admissionId: z.uuid().optional(),
    serviceCode: z.string().trim().toUpperCase().max(40).optional(),
    description: z.string().trim().min(1).max(300).optional(),
    qty: z.coerce.number().positive('Quantity must be more than 0').max(100000).default(1),
    unitPrice: money.optional(),
    taxRate: taxRate.optional(),
    discount: money.optional(),
    doctorId: z.uuid().optional(),
    chargeDate: isoDate.optional(),
    notes: optionalText(300),
  })
  .refine((c) => c.serviceCode || (c.description && c.unitPrice !== undefined), {
    message: 'Pick a service, or give a description and a price',
  });
export type ManualChargeInput = z.input<typeof manualChargeSchema>;

export const cancelChargeSchema = z.object({ reason: reasonText('the reason for cancelling') });
export type CancelChargeInput = z.input<typeof cancelChargeSchema>;

export interface Charge {
  id: string;
  patientId: string;
  facilityId: string;
  account: ChargeAccount;
  visitId: string | null;
  admissionId: string | null;
  sourceModule: string;
  sourceRef: string;
  sourceLine: string;
  serviceId: string | null;
  serviceCode: string | null;
  itemId: string | null;
  description: string;
  hsnSac: string | null;
  qty: number;
  unitPrice: number;
  priceIncludesTax: boolean;
  taxRate: number;
  discount: number;
  /** qty × price − discount, plus GST unless the price already includes it. */
  amount: number;
  doctorId: string | null;
  chargeDate: string;
  status: ChargeStatus;
  invoiceId: string | null;
  invoiceNumber: string | null;
  /** Set when the source was cancelled after the charge was billed: a credit note is suggested. */
  reversalRequestedAt: string | null;
  reversalReason: string | null;
  cancelReason: string | null;
  notes: string | null;
  createdAt: string;
}

export const chargeQuerySchema = z.object({
  patientId: z.uuid().optional(),
  visitId: z.uuid().optional(),
  admissionId: z.uuid().optional(),
  status: z.enum(CHARGE_STATUSES).optional(),
  sourceModule: z.string().max(40).optional(),
  /** Only billed charges whose source was cancelled afterwards (credit note suggested). */
  reversal: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(200),
});
export type ChargeQuery = Partial<Omit<z.input<typeof chargeQuerySchema>, 'reversal'>> & { reversal?: 'true' | 'false' };

/** POST /billing/charges/bill (and BillingService.billCharges): pending charges → one final invoice. */
export const billChargesSchema = z.object({
  patientId: z.uuid(),
  facilityId: z.uuid().optional(),
  /** Pending charges to bill; all must belong to the patient. */
  chargeIds: z.array(z.uuid()).max(500).default([]),
  /** Extra lines typed at the desk (become charges from module 'billing' first, so every line has a charge). */
  extraLines: z.array(invoiceLineInputSchema).max(100).default([]),
  /** Bill-level discount in rupees, spread over the lines largest first. */
  discount: money.optional(),
  payerId: z.uuid().optional(),
  doctorId: z.uuid().optional(),
  supplyType: z.enum(['intra', 'inter']).default('intra'),
  buyerGstin: gstin.optional(),
  notes: optionalText(1000),
  /** Use the patient's advance first (up to the bill total). */
  useDeposit: z.boolean().default(false),
  /** Money taken now, after any advance. */
  payNow: payNowSchema.optional(),
  /** Invoice source, e.g. { module: 'ipd', refId: admissionId }; default { module: 'billing' }. */
  source: z.object({ module: z.string().min(1).max(40), refId: z.string().max(100).optional() }).optional(),
}).refine((b) => b.chargeIds.length + b.extraLines.length > 0, { message: 'Pick at least one charge to bill', path: ['chargeIds'] });
export type BillChargesInput = z.input<typeof billChargesSchema>;

/** One group on the billing desk: an OPD visit, an IPD admission, or other charges. */
export interface ChargeGroup {
  account: ChargeAccount;
  visitId: string | null;
  admissionId: string | null;
  /** e.g. "OPD visit · Dr. Mehta · 08 Oct 2026" or "IPD IP-000123". */
  label: string;
  charges: Charge[];
  total: number;
}

/** GET /billing/patients/:patientId/charges: everything the billing desk needs for one patient. */
export interface PatientCharges {
  patientId: string;
  patientName: string;
  uhid: string;
  mobile: string | null;
  groups: ChargeGroup[];
  pendingTotal: number;
  depositBalance: number;
  outstanding: number;
  /** Payer (insurance / corporate) applied to prices, if the patient has one. */
  payerId: string | null;
  /** Billed charges whose source was cancelled afterwards. */
  reversals: Charge[];
}

/** GET /billing/unbilled: patients with pending charges, oldest first. */
export interface UnbilledPatient {
  patientId: string;
  patientName: string;
  uhid: string;
  mobile: string | null;
  pendingCount: number;
  pendingTotal: number;
  oldestChargeAt: string;
  accounts: ChargeAccount[];
}
export const unbilledQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  account: z.enum(CHARGE_ACCOUNTS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type UnbilledQuery = Partial<z.input<typeof unbilledQuerySchema>>;

/** Payment state of the charges posted by a source, for "unpaid" flags on queues and worklists. */
export type SourcePaymentState = 'none' | 'pending' | 'unpaid' | 'paid';

/** Published as `billing.charges.billed` so modules can store the bill number on their own records. */
export interface ChargesBilledEvent {
  invoiceId: string;
  number: string;
  patientId: string;
  charges: { chargeId: string; module: string; refId: string; line: string }[];
}

// ---------- billing rules (each hospital decides; a branch may override) ----------

export const billingRulesSchema = z.object({
  /** OPD consultation: collect at check-in ('before') or everything at the end of the visit ('after'). */
  opdPayment: z.enum(['before', 'after']),
  /** Unpaid OPD patient: only flag in the doctor's queue, or keep out of the queue until paid. */
  opdUnpaid: z.enum(['flag', 'block']),
  /** Use each doctor's follow-up fee inside their follow-up days, or always charge the full fee. */
  followUp: z.enum(['doctor_fee', 'full_fee']),
  /** Registration fee for new patients (and again once it expires). */
  registrationFee: z.object({
    enabled: z.boolean(),
    amount: money,
    /** Months a registration stays valid; null = never charged again. */
    validityMonths: z.coerce.number().int().min(1).max(120).nullable(),
  }),
  /** Lab tests: charge when ordered, or when the sample is collected. */
  labChargeAt: z.enum(['order', 'collection']),
  /** Radiology: charge when ordered, or when the scan is done. */
  radiologyChargeAt: z.enum(['order', 'scan_done']),
  /** OPD lab / radiology: pay before the sample or scan (flagged on worklists), or after. */
  diagnosticsPayment: z.enum(['before', 'after']),
  /** Medicines for admitted patients: on the IPD bill, or a separate pharmacy bill per issue. */
  ipdPharmacy: z.enum(['ipd_bill', 'separate']),
  /** How a room-rent day is counted. */
  roomRentDay: z.enum(['midnight', 'admission_time', 'checkout_time']),
  /** For 'checkout_time': the day turns at this time (HH:MM, India time). */
  checkoutTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, e.g. 12:00'),
  /** Consumables issued for a patient: charge the patient, or treat as hospital cost. */
  consumables: z.enum(['charge', 'hospital_cost']),
  /** Most discount (% of the bill) a user without billing.discount.override can give. */
  maxDiscountPct: z.coerce.number().min(0).max(100),
});
export type BillingRules = z.infer<typeof billingRulesSchema>;

export const BILLING_RULE_PRESETS = {
  /** Starting values for a hospital with IPD. */
  hospital: {
    opdPayment: 'before',
    opdUnpaid: 'flag',
    followUp: 'doctor_fee',
    registrationFee: { enabled: false, amount: 0, validityMonths: 12 },
    labChargeAt: 'order',
    radiologyChargeAt: 'order',
    diagnosticsPayment: 'before',
    ipdPharmacy: 'ipd_bill',
    roomRentDay: 'midnight',
    checkoutTime: '12:00',
    consumables: 'charge',
    maxDiscountPct: 0,
  },
  /** OPD-only clinic: pay at check-in, no IPD. */
  clinic: {
    opdPayment: 'before',
    opdUnpaid: 'flag',
    followUp: 'doctor_fee',
    registrationFee: { enabled: false, amount: 0, validityMonths: 12 },
    labChargeAt: 'order',
    radiologyChargeAt: 'order',
    diagnosticsPayment: 'before',
    ipdPharmacy: 'separate',
    roomRentDay: 'midnight',
    checkoutTime: '12:00',
    consumables: 'charge',
    maxDiscountPct: 0,
  },
} as const satisfies Record<string, BillingRules>;
export type BillingRulePreset = keyof typeof BILLING_RULE_PRESETS;
export const DEFAULT_BILLING_RULES: BillingRules = BILLING_RULE_PRESETS.hospital;

/** PUT /billing/rules: hospital-wide rules (no facilityId) or a branch override (facilityId). Partial: omitted rules are kept. */
export const billingRulesInputSchema = z.object({
  facilityId: z.uuid().optional(),
  preset: z.enum(['hospital', 'clinic']).optional(),
  rules: billingRulesSchema.partial().default({}),
});
export type BillingRulesInput = z.input<typeof billingRulesInputSchema>;

/** GET /billing/rules?facilityId=: the effective rules plus what the hospital and the branch set. */
export interface BillingRulesView {
  facilityId: string | null;
  effective: BillingRules;
  hospital: Partial<BillingRules>;
  /** Only for a branch: the rules this branch overrides. */
  branch: Partial<BillingRules> | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** POST /billing/charges/:id/credit: credit a billed charge whose source was cancelled (refund if already paid). */
export const creditChargeSchema = z.object({
  reason: reasonText().optional(),
  /** Needed when the bill was already paid and the money must go back. */
  refundMode: z.enum(PAYMENT_MODES).optional(),
});
export type CreditChargeInput = z.input<typeof creditChargeSchema>;
