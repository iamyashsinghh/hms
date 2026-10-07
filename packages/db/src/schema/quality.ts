/**
 * Quality & NABH tables. Owned by the "quality" workstream (Postgres schema: quality).
 * Kept in sync with migrations/*_quality_*.sql (pnpm test checks it).
 */
import { boolean, date, index, integer, jsonb, numeric, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { actorColumns, quality as pg, idColumn, tenantIdColumn, timestamps } from './_common';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const qualityIncidents = pg.table(
  'incidents',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    incidentNo: text('incident_no').notNull(),
    facilityId: uuid('facility_id'),
    kind: text('kind').notNull(),
    category: text('category').notNull(),
    severity: text('severity').notNull(),
    occurredAt: ts('occurred_at').notNull(),
    reportedAt: ts('reported_at').notNull().defaultNow(),
    location: text('location'),
    department: text('department'),
    patientId: uuid('patient_id'),
    description: text('description').notNull(),
    immediateAction: text('immediate_action'),
    isAnonymous: boolean('is_anonymous').notNull().default(false),
    reportedBy: uuid('reported_by'),
    status: text('status').notNull().default('reported'),
    assignedTo: uuid('assigned_to'),
    rootCause: text('root_cause'),
    contributingFactors: text('contributing_factors').array().notNull().default([]),
    closureNote: text('closure_note'),
    closedAt: ts('closed_at'),
    closedBy: uuid('closed_by'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('quality_incidents_no_uq').on(t.tenantId, t.incidentNo)],
);

export const qualityComplaints = pg.table(
  'complaints',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    complaintNo: text('complaint_no').notNull(),
    facilityId: uuid('facility_id'),
    source: text('source').notNull(),
    category: text('category').notNull(),
    priority: text('priority').notNull().default('medium'),
    patientId: uuid('patient_id'),
    complainantName: text('complainant_name').notNull(),
    complainantMobile: text('complainant_mobile'),
    department: text('department'),
    description: text('description').notNull(),
    status: text('status').notNull().default('open'),
    assignedTo: uuid('assigned_to'),
    dueAt: ts('due_at').notNull(),
    resolution: text('resolution'),
    resolvedAt: ts('resolved_at'),
    resolvedBy: uuid('resolved_by'),
    closedAt: ts('closed_at'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('quality_complaints_no_uq').on(t.tenantId, t.complaintNo)],
);

export const qualityHaiCases = pg.table(
  'hai_cases',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    caseNo: text('case_no').notNull(),
    facilityId: uuid('facility_id'),
    patientId: uuid('patient_id').notNull(),
    infectionType: text('infection_type').notNull(),
    ward: text('ward'),
    onsetDate: date('onset_date').notNull(),
    deviceInsertedOn: date('device_inserted_on'),
    procedureName: text('procedure_name'),
    organism: text('organism'),
    cultureRef: text('culture_ref'),
    status: text('status').notNull().default('suspected'),
    notes: text('notes'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('quality_hai_cases_no_uq').on(t.tenantId, t.caseNo)],
);

export const qualityCensus = pg.table(
  'census',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    facilityId: uuid('facility_id').notNull(),
    day: date('day').notNull(),
    ward: text('ward').notNull().default('All'),
    patientDays: integer('patient_days').notNull().default(0),
    catheterDays: integer('catheter_days').notNull().default(0),
    centralLineDays: integer('central_line_days').notNull().default(0),
    ventilatorDays: integer('ventilator_days').notNull().default(0),
    surgeries: integer('surgeries').notNull().default(0),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('quality_census_day_uq').on(t.tenantId, t.facilityId, t.day, t.ward)],
);

export interface ChecklistItemRow {
  id: string;
  text: string;
}
export interface AuditResponseRow {
  itemId: string;
  result: 'yes' | 'no' | 'na';
  remark?: string;
}

export const qualityChecklists = pg.table(
  'checklists',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    items: jsonb('items').$type<ChecklistItemRow[]>().notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const qualityAudits = pg.table(
  'audits',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    auditNo: text('audit_no').notNull(),
    facilityId: uuid('facility_id'),
    checklistId: uuid('checklist_id').notNull(),
    checklistName: text('checklist_name').notNull(),
    category: text('category').notNull(),
    items: jsonb('items').$type<ChecklistItemRow[]>().notNull(),
    department: text('department'),
    scheduledOn: date('scheduled_on').notNull(),
    auditorId: uuid('auditor_id'),
    status: text('status').notNull().default('scheduled'),
    responses: jsonb('responses').$type<AuditResponseRow[]>().notNull().default([]),
    score: numeric('score', { precision: 5, scale: 2 }),
    summary: text('summary'),
    conductedAt: ts('conducted_at'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('quality_audits_no_uq').on(t.tenantId, t.auditNo)],
);

export const qualityCapas = pg.table(
  'capas',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    capaNo: text('capa_no').notNull(),
    facilityId: uuid('facility_id'),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id'),
    title: text('title').notNull(),
    problem: text('problem').notNull(),
    rootCause: text('root_cause'),
    correctiveAction: text('corrective_action'),
    preventiveAction: text('preventive_action'),
    ownerId: uuid('owner_id'),
    dueDate: date('due_date').notNull(),
    status: text('status').notNull().default('open'),
    completionNote: text('completion_note'),
    completedAt: ts('completed_at'),
    completedBy: uuid('completed_by'),
    effectivenessNote: text('effectiveness_note'),
    verifiedAt: ts('verified_at'),
    verifiedBy: uuid('verified_by'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('quality_capas_no_uq').on(t.tenantId, t.capaNo),
    index('quality_capas_source_idx').on(t.tenantId, t.sourceType, t.sourceId),
  ],
);

export const qualityDocuments = pg.table(
  'documents',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    code: text('code').notNull(),
    version: integer('version').notNull().default(1),
    title: text('title').notNull(),
    chapter: text('chapter').notNull(),
    docType: text('doc_type').notNull(),
    department: text('department'),
    content: text('content'),
    fileUrl: text('file_url'),
    status: text('status').notNull().default('draft'),
    effectiveFrom: date('effective_from'),
    reviewDue: date('review_due'),
    approvedBy: uuid('approved_by'),
    approvedAt: ts('approved_at'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('quality_documents_version_uq').on(t.tenantId, t.code, t.version)],
);

export const qualityIndicatorValues = pg.table(
  'indicator_values',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    facilityId: uuid('facility_id').notNull(),
    indicatorCode: text('indicator_code').notNull(),
    period: text('period').notNull(),
    numerator: numeric('numerator', { precision: 14, scale: 2 }).notNull(),
    denominator: numeric('denominator', { precision: 14, scale: 2 }),
    note: text('note'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('quality_indicator_values_uq').on(t.tenantId, t.facilityId, t.indicatorCode, t.period),
  ],
);

/** One row per consumed event; `id` is the event id, so replays are no-ops. */
export const qualityEventFacts = pg.table(
  'event_facts',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').notNull(),
    topic: text('topic').notNull(),
    facilityId: uuid('facility_id'),
    day: date('day').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const qualityActivities = pg.table(
  'activities',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    action: text('action').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    note: text('note'),
    actorId: uuid('actor_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);
