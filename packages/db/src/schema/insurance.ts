/**
 * Insurance & Schemes tables. Owned by the "insurance" workstream (Postgres schema: insurance).
 * Kept in sync with migrations/*_insurance_*.sql (pnpm test checks it). Money is numeric(14,2) (a string in Drizzle).
 */
import { date, foreignKey, index, integer, jsonb, numeric, primaryKey, text, timestamp, uniqueIndex, uuid, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { actorColumns, insurance as pg, idColumn, tenantIdColumn, timestamps } from './_common';
import { facilities, patients } from './core';
import { billingInvoices } from './billing';

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const pct = (name: string) => numeric(name, { precision: 5, scale: 2 });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
const day = (name: string) => date(name, { mode: 'string' });

export const insurancePayers = pg.table(
  'payers',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    scheme: text('scheme'),
    contactName: text('contact_name'),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    gstin: text('gstin'),
    portalUrl: text('portal_url'),
    creditDays: integer('credit_days').notNull().default(30),
    tdsPercent: pct('tds_percent').notNull().default('0'),
    copayPercent: pct('copay_percent').notNull().default('0'),
    creditLimit: money('credit_limit'),
    preauthRequired: boolean('preauth_required').notNull().default(true),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('insurance_payers_code_uq').on(t.tenantId, t.code)],
);

export const insurancePackages = pg.table(
  'packages',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    payerId: uuid('payer_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    specialty: text('specialty'),
    rate: money('rate').notNull(),
    losDays: integer('los_days'),
    preauthRequired: boolean('preauth_required').notNull().default(true),
    inclusions: text('inclusions'),
    isActive: boolean('is_active').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.payerId], foreignColumns: [insurancePayers.tenantId, insurancePayers.id] }),
    uniqueIndex('insurance_packages_code_uq').on(t.tenantId, t.payerId, t.code),
  ],
);

export const insurancePolicies = pg.table(
  'policies',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    patientId: uuid('patient_id').notNull(),
    patientName: text('patient_name').notNull(),
    patientUhid: text('patient_uhid').notNull(),
    payerId: uuid('payer_id').notNull(),
    tpaId: uuid('tpa_id'),
    policyNumber: text('policy_number').notNull(),
    memberId: text('member_id'),
    holderName: text('holder_name'),
    relation: text('relation').notNull().default('self'),
    employeeId: text('employee_id'),
    validFrom: day('valid_from'),
    validTo: day('valid_to'),
    sumInsured: money('sum_insured'),
    copayPercent: pct('copay_percent'),
    roomRentLimit: money('room_rent_limit'),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    verifiedAt: ts('verified_at'),
    verifiedBy: uuid('verified_by'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }),
    foreignKey({ columns: [t.tenantId, t.payerId], foreignColumns: [insurancePayers.tenantId, insurancePayers.id] }),
    foreignKey({ columns: [t.tenantId, t.tpaId], foreignColumns: [insurancePayers.tenantId, insurancePayers.id] }),
    index('insurance_policies_patient_idx').on(t.tenantId, t.patientId),
  ],
);

export const insurancePreauths = pg.table(
  'preauths',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    number: text('number').notNull(),
    facilityId: uuid('facility_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    patientName: text('patient_name').notNull(),
    patientUhid: text('patient_uhid').notNull(),
    policyId: uuid('policy_id').notNull(),
    payerId: uuid('payer_id').notNull(),
    doctorId: uuid('doctor_id'),
    packageId: uuid('package_id'),
    admissionRef: text('admission_ref'),
    diagnosis: text('diagnosis').notNull(),
    icdCodes: text('icd_codes').array().notNull().default(sql`'{}'`),
    procedure: text('procedure'),
    expectedAdmission: day('expected_admission'),
    expectedLosDays: integer('expected_los_days'),
    estimatedAmount: money('estimated_amount').notNull(),
    requestedAmount: money('requested_amount').notNull(),
    approvedAmount: money('approved_amount'),
    payerRef: text('payer_ref'),
    validUntil: day('valid_until'),
    status: text('status').notNull().default('draft'),
    submittedAt: ts('submitted_at'),
    decidedAt: ts('decided_at'),
    notes: text('notes'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.facilityId], foreignColumns: [facilities.tenantId, facilities.id] }),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }),
    foreignKey({ columns: [t.tenantId, t.policyId], foreignColumns: [insurancePolicies.tenantId, insurancePolicies.id] }),
    foreignKey({ columns: [t.tenantId, t.payerId], foreignColumns: [insurancePayers.tenantId, insurancePayers.id] }),
    foreignKey({ columns: [t.tenantId, t.packageId], foreignColumns: [insurancePackages.tenantId, insurancePackages.id] }),
    uniqueIndex('insurance_preauths_number_uq').on(t.tenantId, t.number),
  ],
);

export const insuranceClaims = pg.table(
  'claims',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    number: text('number').notNull(),
    facilityId: uuid('facility_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    patientName: text('patient_name').notNull(),
    patientUhid: text('patient_uhid').notNull(),
    policyId: uuid('policy_id').notNull(),
    payerId: uuid('payer_id').notNull(),
    preauthId: uuid('preauth_id'),
    claimType: text('claim_type').notNull().default('cashless'),
    status: text('status').notNull().default('draft'),
    payerClaimNo: text('payer_claim_no'),
    admissionDate: day('admission_date'),
    dischargeDate: day('discharge_date'),
    diagnosis: text('diagnosis'),
    notes: text('notes'),
    claimedAmount: money('claimed_amount').notNull().default('0'),
    approvedAmount: money('approved_amount'),
    settledAmount: money('settled_amount').notNull().default('0'),
    tdsAmount: money('tds_amount').notNull().default('0'),
    deductionAmount: money('deduction_amount').notNull().default('0'),
    writeOffAmount: money('write_off_amount').notNull().default('0'),
    patientRecoveryAmount: money('patient_recovery_amount').notNull().default('0'),
    submittedAt: ts('submitted_at'),
    dueDate: day('due_date'),
    closedAt: ts('closed_at'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.facilityId], foreignColumns: [facilities.tenantId, facilities.id] }),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }),
    foreignKey({ columns: [t.tenantId, t.policyId], foreignColumns: [insurancePolicies.tenantId, insurancePolicies.id] }),
    foreignKey({ columns: [t.tenantId, t.payerId], foreignColumns: [insurancePayers.tenantId, insurancePayers.id] }),
    foreignKey({ columns: [t.tenantId, t.preauthId], foreignColumns: [insurancePreauths.tenantId, insurancePreauths.id] }),
    uniqueIndex('insurance_claims_number_uq').on(t.tenantId, t.number),
    index('insurance_claims_payer_idx').on(t.tenantId, t.payerId, t.status),
  ],
);

export const insuranceClaimInvoices = pg.table(
  'claim_invoices',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    claimId: uuid('claim_id').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    invoiceNumber: text('invoice_number').notNull(),
    invoiceDate: day('invoice_date').notNull(),
    invoiceTotal: money('invoice_total').notNull(),
    payerAmount: money('payer_amount').notNull(),
    patientAmount: money('patient_amount').notNull(),
    releasedAt: ts('released_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.claimId], foreignColumns: [insuranceClaims.tenantId, insuranceClaims.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.invoiceId], foreignColumns: [billingInvoices.tenantId, billingInvoices.id] }),
    index('insurance_claim_invoices_claim_idx').on(t.tenantId, t.claimId),
  ],
);

export const insuranceClaimDocuments = pg.table(
  'claim_documents',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    claimId: uuid('claim_id').notNull(),
    docType: text('doc_type').notNull(),
    title: text('title').notNull(),
    required: boolean('required').notNull().default(false),
    url: text('url'),
    note: text('note'),
    receivedAt: ts('received_at'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.claimId], foreignColumns: [insuranceClaims.tenantId, insuranceClaims.id] }).onDelete('cascade'),
  ],
);

export interface InsuranceDeductionJson {
  category: string;
  reason: string;
  amount: number;
  recoverFromPatient: boolean;
}

export const insuranceSettlements = pg.table(
  'settlements',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    claimId: uuid('claim_id').notNull(),
    settledOn: day('settled_on').notNull(),
    reference: text('reference').notNull(),
    amountPaid: money('amount_paid').notNull(),
    tdsAmount: money('tds_amount').notNull().default('0'),
    deductions: jsonb('deductions').$type<InsuranceDeductionJson[]>().notNull().default([]),
    deductionAmount: money('deduction_amount').notNull().default('0'),
    writeOffAmount: money('write_off_amount').notNull().default('0'),
    patientRecoveryAmount: money('patient_recovery_amount').notNull().default('0'),
    postingStatus: text('posting_status').notNull().default('pending'),
    postingError: text('posting_error'),
    note: text('note'),
    createdBy: uuid('created_by'),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.claimId], foreignColumns: [insuranceClaims.tenantId, insuranceClaims.id] }),
    index('insurance_settlements_claim_idx').on(t.tenantId, t.claimId),
  ],
);

export const insuranceSettlementPostings = pg.table(
  'settlement_postings',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    settlementId: uuid('settlement_id').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    invoiceNumber: text('invoice_number').notNull(),
    kind: text('kind').notNull(),
    amount: money('amount').notNull(),
    billingRef: text('billing_ref'),
    postedAt: ts('posted_at'),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.settlementId], foreignColumns: [insuranceSettlements.tenantId, insuranceSettlements.id] }),
    uniqueIndex('insurance_settlement_postings_uq').on(t.tenantId, t.settlementId, t.invoiceId, t.kind),
  ],
);

export const insuranceCaseEvents = pg.table(
  'case_events',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id').notNull(),
    action: text('action').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    amount: money('amount'),
    note: text('note'),
    createdBy: uuid('created_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index('insurance_case_events_entity_idx').on(t.tenantId, t.entity, t.entityId, t.createdAt)],
);
