import { z } from 'zod';
import { defineModule } from '../manifest';
import { patchSchema } from '../patch';

/**
 * Insurance & Schemes: payers (insurers, TPAs, corporates, PM-JAY/CGHS-style schemes), scheme packages,
 * patient policies, pre-authorisations, claims and settlements. Owned by the "insurance" workstream.
 * Money travels as numbers in rupees with 2 decimals. Payer price lists are billing price lists with
 * `payerId` set to an insurance payer id.
 */
export const insuranceModule = defineModule({
  key: 'insurance',
  name: 'Insurance & Schemes',
  permissions: [
    { key: 'insurance.payer.read', description: 'View insurers, TPAs, corporates, schemes and their packages' },
    { key: 'insurance.payer.manage', description: 'Create and edit payers and scheme packages' },
    { key: 'insurance.policy.read', description: "View patients' insurance policies and coverage" },
    { key: 'insurance.policy.manage', description: "Add, edit and verify patients' insurance policies" },
    { key: 'insurance.preauth.read', description: 'View pre-authorisation requests' },
    { key: 'insurance.preauth.manage', description: 'Raise and update pre-authorisation requests' },
    { key: 'insurance.claim.read', description: 'View claims and payer splits on bills' },
    { key: 'insurance.claim.manage', description: 'Prepare, submit and track claims' },
    { key: 'insurance.settlement.record', description: 'Record claim settlements, TDS and deductions (posts to billing)' },
    { key: 'insurance.report.read', description: 'View insurance receivables and ageing' },
  ],
  grants: {
    hospital_admin: [
      'insurance.payer.read', 'insurance.payer.manage', 'insurance.policy.read', 'insurance.policy.manage',
      'insurance.preauth.read', 'insurance.preauth.manage', 'insurance.claim.read', 'insurance.claim.manage',
      'insurance.settlement.record', 'insurance.report.read',
    ],
    owner: ['insurance.payer.read', 'insurance.policy.read', 'insurance.preauth.read', 'insurance.claim.read', 'insurance.report.read'],
    accountant: [
      'insurance.payer.read', 'insurance.payer.manage', 'insurance.policy.read', 'insurance.preauth.read',
      'insurance.claim.read', 'insurance.claim.manage', 'insurance.settlement.record', 'insurance.report.read',
    ],
    billing_clerk: [
      'insurance.payer.read', 'insurance.policy.read', 'insurance.policy.manage', 'insurance.preauth.read',
      'insurance.preauth.manage', 'insurance.claim.read', 'insurance.claim.manage',
    ],
    receptionist: ['insurance.payer.read', 'insurance.policy.read', 'insurance.policy.manage', 'insurance.preauth.read', 'insurance.claim.read'],
    doctor: ['insurance.payer.read', 'insurance.policy.read', 'insurance.preauth.read'],
  },
});

// ---------- shared bits ----------

const money = z.coerce
  .number()
  .min(0)
  .max(99_999_999_999.99)
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'At most 2 decimal places');
const positiveMoney = money.refine((v) => v > 0, 'Must be more than 0');
const percent = z.coerce.number().min(0).max(100);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
const gstin = z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/, 'Enter a valid 15-character GSTIN');
const page = z.coerce.number().int().min(1).default(1);
const pageSize = (max = 200, def = 25) => z.coerce.number().int().min(1).max(max).default(def);
const note = z.object({ note: optionalText(1000) });

export const PAYER_TYPES = ['insurer', 'tpa', 'corporate', 'government'] as const;
/** Government / public schemes (payer type 'government'). */
export const SCHEMES = ['pmjay', 'cghs', 'echs', 'esic', 'state', 'other'] as const;
export const RELATIONS = ['self', 'spouse', 'child', 'parent', 'sibling', 'other'] as const;
export const PREAUTH_STATUSES = ['draft', 'submitted', 'query', 'approved', 'rejected', 'cancelled'] as const;
export const CLAIM_TYPES = ['cashless', 'credit'] as const;
export const CLAIM_STATUSES = ['draft', 'submitted', 'query', 'approved', 'partially_settled', 'settled', 'rejected', 'cancelled'] as const;
/** Claims the payer still owes money on. */
export const OPEN_CLAIM_STATUSES = ['submitted', 'query', 'approved', 'partially_settled'] as const;
export const DOCUMENT_TYPES = [
  'preauth_form', 'policy_card', 'id_proof', 'consultation_notes', 'investigation_reports', 'discharge_summary',
  'final_bill', 'pharmacy_bills', 'claim_form', 'other',
] as const;
export const DEDUCTION_CATEGORIES = ['non_payable', 'tariff_difference', 'copay', 'policy_limit', 'room_rent', 'other'] as const;

export type PayerType = (typeof PAYER_TYPES)[number];
export type Scheme = (typeof SCHEMES)[number];
export type Relation = (typeof RELATIONS)[number];
export type PreauthStatus = (typeof PREAUTH_STATUSES)[number];
export type ClaimType = (typeof CLAIM_TYPES)[number];
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type DeductionCategory = (typeof DEDUCTION_CATEGORIES)[number];

// ---------- payers ----------

const payerBase = z.object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_.-]{0,29}$/, 'Letters, digits, - _ . (max 30)'),
    name: z.string().trim().min(2).max(200),
    type: z.enum(PAYER_TYPES),
    scheme: z.enum(SCHEMES).nullable().optional(),
    contactName: nullableText(120),
    phone: nullableText(30),
    email: z.union([z.email(), z.literal('')]).nullable().optional(),
    address: nullableText(500),
    gstin: z.union([gstin, z.literal('')]).nullable().optional(),
    portalUrl: z.union([z.url(), z.literal('')]).nullable().optional(),
    /** Days the payer has to settle after a claim is submitted (used for ageing and due dates). */
    creditDays: z.coerce.number().int().min(0).max(365).default(30),
    /** TDS the payer usually deducts (194J is 10%); a hint for the settlement form. */
    tdsPercent: percent.default(0),
    /** Default co-pay the patient bears, applied when a policy has none. */
    copayPercent: percent.default(0),
    /** Corporate credit limit (outstanding claims above it show a warning). */
    creditLimit: money.nullable().optional(),
    preauthRequired: z.boolean().default(true),
    notes: nullableText(1000),
    isActive: z.boolean().default(true),
  });
export const payerInputSchema = payerBase.refine((p) => p.type !== 'government' || !!p.scheme, { message: 'Pick the scheme', path: ['scheme'] });
export type PayerInput = z.input<typeof payerInputSchema>;
// patchSchema, not .partial(): Zod 4 keeps defaults inside .partial(), so a PATCH would reset omitted fields.
export const updatePayerSchema = patchSchema(payerBase.omit({ code: true }));
export type UpdatePayer = z.input<typeof updatePayerSchema>;

export interface Payer {
  id: string;
  code: string;
  name: string;
  type: PayerType;
  scheme: Scheme | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  portalUrl: string | null;
  creditDays: number;
  tdsPercent: number;
  copayPercent: number;
  creditLimit: number | null;
  preauthRequired: boolean;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const payerQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.enum(PAYER_TYPES).optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
  page,
  pageSize: pageSize(200, 50),
});
export type PayerQuery = { q?: string; type?: PayerType; active?: 'true' | 'false' | 'all'; page?: number; pageSize?: number };

// ---------- scheme packages (PM-JAY HBP, CGHS rates, corporate packages) ----------

export const packageInputSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_.-]{0,39}$/, 'Letters, digits, - _ . (max 40)'),
  name: z.string().trim().min(2).max(300),
  specialty: nullableText(120),
  rate: money,
  /** Expected length of stay, days. */
  losDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  preauthRequired: z.boolean().default(true),
  inclusions: nullableText(2000),
  isActive: z.boolean().default(true),
});
export type PackageInput = z.input<typeof packageInputSchema>;
export const updatePackageSchema = patchSchema(packageInputSchema.omit({ code: true }));
export type UpdatePackage = z.input<typeof updatePackageSchema>;

export interface SchemePackage {
  id: string;
  payerId: string;
  code: string;
  name: string;
  specialty: string | null;
  rate: number;
  losDays: number | null;
  preauthRequired: boolean;
  inclusions: string | null;
  isActive: boolean;
}

// ---------- patient policies ----------

const policyBase = z.object({
    patientId: z.uuid(),
    /** Insurer, corporate or scheme that carries the risk. */
    payerId: z.uuid(),
    /** TPA that processes claims for the insurer (claims then go to the TPA). */
    tpaId: z.uuid().nullable().optional(),
    policyNumber: z.string().trim().min(1).max(60),
    /** Card / member / beneficiary id (PM-JAY ID, CGHS card, employee code…). */
    memberId: nullableText(60),
    holderName: nullableText(120),
    relation: z.enum(RELATIONS).default('self'),
    employeeId: nullableText(60),
    validFrom: z.iso.date().nullable().optional(),
    validTo: z.iso.date().nullable().optional(),
    sumInsured: money.nullable().optional(),
    /** Overrides the payer's default co-pay. */
    copayPercent: percent.nullable().optional(),
    roomRentLimit: money.nullable().optional(),
    notes: nullableText(1000),
    isActive: z.boolean().default(true),
  });
const datesInOrder = (v: { validFrom?: string | null; validTo?: string | null }) => !v.validFrom || !v.validTo || v.validTo >= v.validFrom;
export const policyInputSchema = policyBase.refine(datesInOrder, { message: 'End date is before start date', path: ['validTo'] });
export type PolicyInput = z.input<typeof policyInputSchema>;
export const updatePolicySchema = patchSchema(policyBase.omit({ patientId: true })).refine(datesInOrder, { message: 'End date is before start date', path: ['validTo'] });
export type UpdatePolicy = z.input<typeof updatePolicySchema>;

export interface Policy {
  id: string;
  patientId: string;
  patientName: string;
  patientUhid: string;
  payerId: string;
  payerName: string;
  payerType: PayerType;
  tpaId: string | null;
  tpaName: string | null;
  /** Who claims are sent to: the TPA when set, else the payer. */
  claimPayerId: string;
  policyNumber: string;
  memberId: string | null;
  holderName: string | null;
  relation: Relation;
  employeeId: string | null;
  validFrom: string | null;
  validTo: string | null;
  sumInsured: number | null;
  copayPercent: number | null;
  roomRentLimit: number | null;
  notes: string | null;
  isActive: boolean;
  verifiedAt: string | null;
  /** Sum insured minus what open and settled claims on this policy have used (null when no sum insured). */
  balanceSumInsured: number | null;
  createdAt: string;
}

export const policyQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  patientId: z.uuid().optional(),
  payerId: z.uuid().optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
  page,
  pageSize: pageSize(),
});
export type PolicyQuery = { q?: string; patientId?: string; payerId?: string; active?: 'true' | 'false' | 'all'; page?: number; pageSize?: number };

/** Result of the (mock) eligibility check. No external call is made. */
export interface EligibilityResult {
  policyId: string;
  eligible: boolean;
  reasons: string[];
  checkedAt: string;
}

// ---------- history (pre-auths and claims) ----------

export interface CaseEvent {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  amount: number | null;
  note: string | null;
  by: string | null;
  byName: string | null;
  at: string;
}

// ---------- pre-authorisation ----------

export const preauthInputSchema = z.object({
  policyId: z.uuid(),
  facilityId: z.uuid().optional(),
  doctorId: z.uuid().nullable().optional(),
  packageId: z.uuid().nullable().optional(),
  /** Admission / encounter this is for (IPD admission id or number), free text until IPD lands. */
  admissionRef: nullableText(100),
  diagnosis: z.string().trim().min(2).max(1000),
  icdCodes: z.array(z.string().trim().toUpperCase().regex(/^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/, 'ICD-10 code like K35.8')).max(20).default([]),
  procedure: nullableText(1000),
  expectedAdmission: z.iso.date().nullable().optional(),
  expectedLosDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  estimatedAmount: money,
  /** Defaults to the estimate. */
  requestedAmount: money.optional(),
  notes: nullableText(1000),
});
export type PreauthInput = z.input<typeof preauthInputSchema>;
export const updatePreauthSchema = patchSchema(preauthInputSchema.omit({ policyId: true, facilityId: true }));
export type UpdatePreauth = z.input<typeof updatePreauthSchema>;

export const preauthApproveSchema = z.object({
  approvedAmount: positiveMoney,
  payerRef: optionalText(60),
  validUntil: z.iso.date().optional(),
  note: optionalText(1000),
});
export type PreauthApprove = z.input<typeof preauthApproveSchema>;
export const preauthEnhanceSchema = z.object({ requestedAmount: positiveMoney, note: z.string().trim().min(3).max(1000) });
export type PreauthEnhance = z.input<typeof preauthEnhanceSchema>;
export const reasonSchema = z.object({ note: z.string().trim().min(3).max(1000) });
export type ReasonInput = z.input<typeof reasonSchema>;
export const noteSchema = note;
export type NoteInput = z.input<typeof noteSchema>;
export const submitSchema = z.object({ payerRef: optionalText(60), note: optionalText(1000) });
export type SubmitInput = z.input<typeof submitSchema>;

export interface PreauthSummary {
  id: string;
  number: string;
  status: PreauthStatus;
  facilityId: string;
  patientId: string;
  patientName: string;
  patientUhid: string;
  policyId: string;
  payerId: string;
  payerName: string;
  diagnosis: string;
  requestedAmount: number;
  approvedAmount: number | null;
  submittedAt: string | null;
  createdAt: string;
}

export interface Preauth extends PreauthSummary {
  doctorId: string | null;
  packageId: string | null;
  packageCode: string | null;
  packageName: string | null;
  admissionRef: string | null;
  icdCodes: string[];
  procedure: string | null;
  expectedAdmission: string | null;
  expectedLosDays: number | null;
  estimatedAmount: number;
  payerRef: string | null;
  validUntil: string | null;
  notes: string | null;
  policy: Policy;
  history: CaseEvent[];
}

export const preauthQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(PREAUTH_STATUSES).optional(),
  payerId: z.uuid().optional(),
  patientId: z.uuid().optional(),
  page,
  pageSize: pageSize(),
});
export type PreauthQuery = { q?: string; status?: PreauthStatus; payerId?: string; patientId?: string; page?: number; pageSize?: number };

// ---------- claims ----------

export const claimInputSchema = z.object({
  policyId: z.uuid(),
  preauthId: z.uuid().nullable().optional(),
  facilityId: z.uuid().optional(),
  claimType: z.enum(CLAIM_TYPES).default('cashless'),
  /**
   * Final bills to claim. `payerAmount` is the payer's share of that bill; when omitted it is the bill's
   * unpaid balance less the co-pay, capped by the pre-auth approval and the policy's remaining sum insured.
   */
  invoices: z
    .array(z.object({ invoiceId: z.uuid(), payerAmount: money.optional() }))
    .min(1)
    .max(50)
    .refine((l) => new Set(l.map((i) => i.invoiceId)).size === l.length, 'A bill is listed twice'),
  admissionDate: z.iso.date().nullable().optional(),
  dischargeDate: z.iso.date().nullable().optional(),
  diagnosis: nullableText(1000),
  notes: nullableText(1000),
});
export type ClaimInput = z.input<typeof claimInputSchema>;

export const updateClaimSchema = z.object({
  admissionDate: z.iso.date().nullable().optional(),
  dischargeDate: z.iso.date().nullable().optional(),
  diagnosis: nullableText(1000),
  notes: nullableText(1000),
  /** Draft only: change the payer's share on a bill. */
  invoices: z.array(z.object({ invoiceId: z.uuid(), payerAmount: money })).max(50).optional(),
});
export type UpdateClaim = z.input<typeof updateClaimSchema>;

export const claimApproveSchema = z.object({ approvedAmount: money, payerClaimNo: optionalText(60), note: optionalText(1000) });
export type ClaimApprove = z.input<typeof claimApproveSchema>;

export const deductionSchema = z.object({
  category: z.enum(DEDUCTION_CATEGORIES),
  reason: z.string().trim().min(2).max(300),
  amount: positiveMoney,
  /** true: the patient pays it (stays due on the bill); false: the hospital writes it off (credit note). */
  recoverFromPatient: z.boolean().default(false),
});
export type Deduction = z.output<typeof deductionSchema>;

export const settlementInputSchema = z
  .object({
    settledOn: z.iso.date(),
    /** UTR / NEFT / cheque reference. */
    reference: z.string().trim().min(2).max(100),
    amountPaid: money,
    tdsAmount: money.default(0),
    deductions: z.array(deductionSchema).max(50).default([]),
    note: optionalText(1000),
  })
  .refine((s) => s.amountPaid + s.tdsAmount + s.deductions.reduce((a, d) => a + d.amount, 0) > 0, {
    message: 'Enter the amount paid, TDS or a deduction',
    path: ['amountPaid'],
  });
export type SettlementInput = z.input<typeof settlementInputSchema>;

export interface ClaimInvoice {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceTotal: number;
  payerAmount: number;
  patientAmount: number;
}

export interface ClaimDocument {
  id: string;
  docType: DocumentType;
  title: string;
  required: boolean;
  url: string | null;
  note: string | null;
  receivedAt: string | null;
}

export const documentInputSchema = z.object({
  docType: z.enum(DOCUMENT_TYPES),
  title: z.string().trim().min(2).max(200),
  required: z.boolean().default(false),
  url: z.union([z.url(), z.literal('')]).nullable().optional(),
  note: nullableText(500),
  received: z.boolean().default(false),
});
export type DocumentInput = z.input<typeof documentInputSchema>;
export const updateDocumentSchema = patchSchema(documentInputSchema);
export type UpdateDocument = z.input<typeof updateDocumentSchema>;

export interface SettlementPosting {
  invoiceId: string;
  invoiceNumber: string;
  /** recovery = a deduction the patient pays; it stays due on the bill and posts nothing. */
  kind: 'payment' | 'tds' | 'write_off' | 'recovery';
  amount: number;
  /** Billing receipt or credit-note number, once posted. */
  billingRef: string | null;
  postedAt: string | null;
}

export interface Settlement {
  id: string;
  settledOn: string;
  reference: string;
  amountPaid: number;
  tdsAmount: number;
  deductions: Deduction[];
  deductionAmount: number;
  writeOffAmount: number;
  patientRecoveryAmount: number;
  postingStatus: 'pending' | 'posted' | 'failed';
  postingError: string | null;
  postings: SettlementPosting[];
  note: string | null;
  createdAt: string;
}

export interface ClaimSummary {
  id: string;
  number: string;
  status: ClaimStatus;
  claimType: ClaimType;
  facilityId: string;
  patientId: string;
  patientName: string;
  patientUhid: string;
  payerId: string;
  payerName: string;
  claimedAmount: number;
  approvedAmount: number | null;
  settledAmount: number;
  tdsAmount: number;
  deductionAmount: number;
  /** What the payer still owes: (approved, else claimed) minus paid, TDS and deductions. */
  outstanding: number;
  submittedAt: string | null;
  dueDate: string | null;
  createdAt: string;
}

export interface Claim extends ClaimSummary {
  policyId: string;
  preauthId: string | null;
  preauthNumber: string | null;
  payerClaimNo: string | null;
  admissionDate: string | null;
  dischargeDate: string | null;
  diagnosis: string | null;
  notes: string | null;
  writeOffAmount: number;
  patientRecoveryAmount: number;
  policy: Policy;
  invoices: ClaimInvoice[];
  documents: ClaimDocument[];
  settlements: Settlement[];
  history: CaseEvent[];
}

export const claimQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(CLAIM_STATUSES).optional(),
  open: z.enum(['true', 'false']).optional(),
  payerId: z.uuid().optional(),
  patientId: z.uuid().optional(),
  page,
  pageSize: pageSize(),
});
export type ClaimQuery = { q?: string; status?: ClaimStatus; open?: 'true' | 'false'; payerId?: string; patientId?: string; page?: number; pageSize?: number };

/** How a bill splits between the payer and the patient (agreed contract for billing, portal, mobile). */
export interface InvoiceSplit {
  invoiceId: string;
  claimId: string | null;
  claimNumber: string | null;
  claimStatus: ClaimStatus | null;
  payerId: string | null;
  payerName: string | null;
  total: number;
  payerAmount: number;
  patientAmount: number;
  /** Payer share not yet paid, TDS'd or deducted. */
  payerOutstanding: number;
  /** What the patient should pay now: the bill's balance minus payerOutstanding. */
  patientDue: number;
}

// ---------- reports ----------

export interface AgeingBuckets {
  d0_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
}

export interface InsuranceSummary {
  preauths: Record<PreauthStatus, number>;
  claims: Record<ClaimStatus, number>;
  outstanding: number;
  overdue: number;
  byPayer: {
    payerId: string;
    payerName: string;
    payerType: PayerType;
    openClaims: number;
    outstanding: number;
    overdue: number;
    creditLimit: number | null;
    ageing: AgeingBuckets;
  }[];
  settledThisMonth: number;
  deductionsThisMonth: number;
}

// ---------- events ----------

export interface PreauthApprovedEvent {
  preauthId: string;
  number: string;
  patientId: string;
  payerId: string;
  approvedAmount: number;
}
export interface ClaimSubmittedEvent {
  claimId: string;
  number: string;
  patientId: string;
  payerId: string;
  claimedAmount: number;
  invoiceIds: string[];
}
export interface ClaimSettledEvent {
  claimId: string;
  number: string;
  patientId: string;
  payerId: string;
  settlementId: string;
  amountPaid: number;
  tdsAmount: number;
  deductionAmount: number;
  patientRecoveryAmount: number;
  status: ClaimStatus;
  settledOn: string;
}
