-- quality: NABH-oriented quality management. Incident / near-miss reporting, patient complaints,
-- hospital-acquired infection (HAI) surveillance, audits against checklists, CAPA tracking,
-- the NABH document library, daily census denominators, manual indicator values and
-- event facts (counts taken from other modules' events, never from their tables).

-- ---------- incidents (incl. near misses, adverse and sentinel events) ----------

CREATE TABLE quality.incidents (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  incident_no text NOT NULL,
  facility_id uuid,
  kind text NOT NULL CHECK (kind IN ('near_miss', 'incident', 'adverse_event', 'sentinel_event')),
  category text NOT NULL CHECK (category IN (
    'medication_error', 'adverse_drug_reaction', 'patient_fall', 'needle_stick_injury', 'wrong_patient',
    'wrong_site_surgery', 'transfusion_reaction', 'pressure_ulcer', 'equipment_failure', 'fire_safety',
    'violence', 'documentation', 'infection_control', 'other')),
  severity text NOT NULL CHECK (severity IN ('no_harm', 'mild', 'moderate', 'severe', 'death')),
  occurred_at timestamptz NOT NULL,
  reported_at timestamptz NOT NULL DEFAULT now(),
  location text,
  department text,
  patient_id uuid,
  description text NOT NULL,
  immediate_action text,
  is_anonymous boolean NOT NULL DEFAULT false,
  -- NULL when reported anonymously (just culture: the reporter is never stored).
  reported_by uuid,
  status text NOT NULL DEFAULT 'reported'
    CHECK (status IN ('reported', 'under_review', 'action_planned', 'closed', 'rejected')),
  assigned_to uuid,
  root_cause text,
  contributing_factors text[] NOT NULL DEFAULT '{}',
  closure_note text,
  closed_at timestamptz,
  closed_by uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  CHECK (occurred_at <= reported_at + interval '5 minutes'),
  CHECK (NOT is_anonymous OR reported_by IS NULL)
);
CREATE UNIQUE INDEX quality_incidents_no_uq ON quality.incidents (tenant_id, incident_no);
CREATE INDEX quality_incidents_status_idx ON quality.incidents (tenant_id, status, occurred_at DESC);
CREATE INDEX quality_incidents_reporter_idx ON quality.incidents (tenant_id, reported_by) WHERE reported_by IS NOT NULL;
SELECT app.enable_tenant_rls('quality.incidents');
SELECT app.enable_updated_at('quality.incidents');
SELECT app.enable_audit('quality.incidents');

-- ---------- patient complaints ----------

CREATE TABLE quality.complaints (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  complaint_no text NOT NULL,
  facility_id uuid,
  source text NOT NULL CHECK (source IN ('walk_in', 'phone', 'email', 'feedback_form', 'portal', 'social_media', 'other')),
  category text NOT NULL CHECK (category IN (
    'clinical_care', 'staff_behaviour', 'waiting_time', 'billing', 'cleanliness', 'food', 'facilities', 'other')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  patient_id uuid,
  complainant_name text NOT NULL,
  complainant_mobile text,
  department text,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  assigned_to uuid,
  due_at timestamptz NOT NULL,
  resolution text,
  resolved_at timestamptz,
  resolved_by uuid,
  closed_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id)
);
CREATE UNIQUE INDEX quality_complaints_no_uq ON quality.complaints (tenant_id, complaint_no);
CREATE INDEX quality_complaints_status_idx ON quality.complaints (tenant_id, status, created_at DESC);
SELECT app.enable_tenant_rls('quality.complaints');
SELECT app.enable_updated_at('quality.complaints');
SELECT app.enable_audit('quality.complaints');

-- ---------- hospital-acquired infections ----------

CREATE TABLE quality.hai_cases (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  case_no text NOT NULL,
  facility_id uuid,
  patient_id uuid NOT NULL,
  infection_type text NOT NULL CHECK (infection_type IN ('cauti', 'clabsi', 'vap', 'ssi', 'other')),
  ward text,
  onset_date date NOT NULL,
  device_inserted_on date,
  procedure_name text,
  organism text,
  culture_ref text,
  status text NOT NULL DEFAULT 'suspected' CHECK (status IN ('suspected', 'confirmed', 'ruled_out')),
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id)
);
CREATE UNIQUE INDEX quality_hai_cases_no_uq ON quality.hai_cases (tenant_id, case_no);
CREATE INDEX quality_hai_cases_onset_idx ON quality.hai_cases (tenant_id, onset_date);
SELECT app.enable_tenant_rls('quality.hai_cases');
SELECT app.enable_updated_at('quality.hai_cases');
SELECT app.enable_audit('quality.hai_cases');

-- ---------- daily census: denominators for HAI and fall rates ----------
-- Entered by the infection-control nurse per ward per day until IPD publishes a census event.

CREATE TABLE quality.census (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  facility_id uuid NOT NULL,
  day date NOT NULL,
  ward text NOT NULL DEFAULT 'All',
  patient_days integer NOT NULL DEFAULT 0 CHECK (patient_days >= 0),
  catheter_days integer NOT NULL DEFAULT 0 CHECK (catheter_days >= 0),
  central_line_days integer NOT NULL DEFAULT 0 CHECK (central_line_days >= 0),
  ventilator_days integer NOT NULL DEFAULT 0 CHECK (ventilator_days >= 0),
  surgeries integer NOT NULL DEFAULT 0 CHECK (surgeries >= 0),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX quality_census_day_uq ON quality.census (tenant_id, facility_id, day, ward);
SELECT app.enable_tenant_rls('quality.census');
SELECT app.enable_updated_at('quality.census');

-- ---------- audit checklists and audits ----------

CREATE TABLE quality.checklists (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  name text NOT NULL,
  category text NOT NULL CHECK (category IN (
    'hand_hygiene', 'infection_control', 'medication_safety', 'documentation', 'patient_safety', 'facility_safety', 'clinical', 'other')),
  -- [{ "id": "1", "text": "Hand rub available at point of care" }, …]
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX quality_checklists_name_uq ON quality.checklists (tenant_id, lower(name));
SELECT app.enable_tenant_rls('quality.checklists');
SELECT app.enable_updated_at('quality.checklists');

CREATE TABLE quality.audits (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  audit_no text NOT NULL,
  facility_id uuid,
  checklist_id uuid NOT NULL,
  -- Snapshot of the checklist so later edits do not change past audits.
  checklist_name text NOT NULL,
  category text NOT NULL,
  items jsonb NOT NULL,
  department text,
  scheduled_on date NOT NULL,
  auditor_id uuid,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  -- [{ "itemId": "1", "result": "yes" | "no" | "na", "remark": "…" }, …]
  responses jsonb NOT NULL DEFAULT '[]',
  score numeric(5,2) CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  summary text,
  conducted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, checklist_id) REFERENCES quality.checklists (tenant_id, id)
);
CREATE UNIQUE INDEX quality_audits_no_uq ON quality.audits (tenant_id, audit_no);
CREATE INDEX quality_audits_scheduled_idx ON quality.audits (tenant_id, scheduled_on DESC);
SELECT app.enable_tenant_rls('quality.audits');
SELECT app.enable_updated_at('quality.audits');
SELECT app.enable_audit('quality.audits');

-- ---------- CAPA (corrective and preventive actions) ----------

CREATE TABLE quality.capas (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  capa_no text NOT NULL,
  facility_id uuid,
  source_type text NOT NULL CHECK (source_type IN ('incident', 'complaint', 'audit', 'hai', 'indicator', 'other')),
  source_id uuid,
  title text NOT NULL,
  problem text NOT NULL,
  root_cause text,
  corrective_action text,
  preventive_action text,
  owner_id uuid,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'verified', 'cancelled')),
  completion_note text,
  completed_at timestamptz,
  completed_by uuid,
  effectiveness_note text,
  verified_at timestamptz,
  verified_by uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CHECK (source_type = 'other' OR source_type = 'indicator' OR source_id IS NOT NULL)
);
CREATE UNIQUE INDEX quality_capas_no_uq ON quality.capas (tenant_id, capa_no);
CREATE INDEX quality_capas_source_idx ON quality.capas (tenant_id, source_type, source_id);
CREATE INDEX quality_capas_due_idx ON quality.capas (tenant_id, status, due_date);
SELECT app.enable_tenant_rls('quality.capas');
SELECT app.enable_updated_at('quality.capas');
SELECT app.enable_audit('quality.capas');

-- ---------- NABH document library (policies, SOPs, forms) ----------

CREATE TABLE quality.documents (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_./-]{0,39}$'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  title text NOT NULL,
  chapter text NOT NULL CHECK (chapter IN ('AAC', 'COP', 'MOM', 'PRE', 'HIC', 'PSQ', 'ROM', 'FMS', 'HRM', 'IMS')),
  doc_type text NOT NULL CHECK (doc_type IN ('policy', 'sop', 'manual', 'plan', 'form', 'register', 'other')),
  department text,
  content text,
  file_url text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'archived')),
  effective_from date,
  review_due date,
  approved_by uuid,
  approved_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX quality_documents_version_uq ON quality.documents (tenant_id, code, version);
-- At most one approved (current) version per document code.
CREATE UNIQUE INDEX quality_documents_current_uq ON quality.documents (tenant_id, code) WHERE status = 'approved';
SELECT app.enable_tenant_rls('quality.documents');
SELECT app.enable_updated_at('quality.documents');
SELECT app.enable_audit('quality.documents');

-- ---------- manual indicator values (monthly) ----------

CREATE TABLE quality.indicator_values (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  facility_id uuid NOT NULL,
  indicator_code text NOT NULL,
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  numerator numeric(14,2) NOT NULL CHECK (numerator >= 0),
  denominator numeric(14,2) CHECK (denominator IS NULL OR denominator > 0),
  note text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX quality_indicator_values_uq ON quality.indicator_values (tenant_id, facility_id, indicator_code, period);
SELECT app.enable_tenant_rls('quality.indicator_values');
SELECT app.enable_updated_at('quality.indicator_values');
SELECT app.enable_audit('quality.indicator_values');

-- ---------- event facts: one row per consumed event (the event id), so handlers are idempotent ----------

CREATE TABLE quality.event_facts (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL,
  topic text NOT NULL,
  facility_id uuid,
  day date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX quality_event_facts_topic_day_idx ON quality.event_facts (tenant_id, topic, day);
SELECT app.enable_tenant_rls('quality.event_facts');

-- ---------- activity trail shown on incident / complaint / CAPA pages ----------

CREATE TABLE quality.activities (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  entity_type text NOT NULL CHECK (entity_type IN ('incident', 'complaint', 'capa', 'hai', 'audit', 'document')),
  entity_id uuid NOT NULL,
  action text NOT NULL,
  from_status text,
  to_status text,
  note text,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX quality_activities_entity_idx ON quality.activities (tenant_id, entity_type, entity_id, created_at);
SELECT app.enable_tenant_rls('quality.activities');
