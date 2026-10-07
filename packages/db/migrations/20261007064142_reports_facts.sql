-- reports: reporting fact tables.
-- Other modules are built in parallel, so reports does not query their tables. Instead the worker
-- projects the agreed events (PARALLEL_PLAN.md section 4) into these read-optimised tables.
-- Every raw event is kept in reporting.ingested_events, which makes handlers idempotent and lets us
-- rebuild the facts later if a projection changes. These rows are derived data: no audit trigger.

CREATE TABLE reporting.ingested_events (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,                       -- the outbox event id
  topic text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX ingested_events_topic_idx ON reporting.ingested_events (tenant_id, topic, occurred_at);
SELECT app.enable_tenant_rls('reporting.ingested_events');

CREATE TABLE reporting.opd_visits (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  visit_id uuid NOT NULL,
  appointment_id uuid,
  patient_id uuid NOT NULL,
  doctor_id uuid,
  facility_id uuid,
  token_no integer,
  checked_in_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX opd_visits_visit_uq ON reporting.opd_visits (tenant_id, visit_id);
CREATE INDEX opd_visits_time_idx ON reporting.opd_visits (tenant_id, checked_in_at);
CREATE INDEX opd_visits_appt_idx ON reporting.opd_visits (tenant_id, appointment_id);
SELECT app.enable_tenant_rls('reporting.opd_visits');

CREATE TABLE reporting.appointments (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  appointment_id uuid NOT NULL,
  patient_id uuid,
  doctor_id uuid,
  facility_id uuid,
  start_at timestamptz,
  status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled')),
  booked_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX appointments_appt_uq ON reporting.appointments (tenant_id, appointment_id);
CREATE INDEX appointments_start_idx ON reporting.appointments (tenant_id, start_at);
SELECT app.enable_tenant_rls('reporting.appointments');
SELECT app.enable_updated_at('reporting.appointments');

CREATE TABLE reporting.encounters (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  encounter_id uuid NOT NULL,
  patient_id uuid,
  doctor_id uuid,
  signed_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX encounters_encounter_uq ON reporting.encounters (tenant_id, encounter_id);
CREATE INDEX encounters_time_idx ON reporting.encounters (tenant_id, signed_at);
SELECT app.enable_tenant_rls('reporting.encounters');

CREATE TABLE reporting.invoices (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  invoice_id uuid NOT NULL,
  number text,
  patient_id uuid,
  facility_id uuid,
  doctor_id uuid,
  source_module text,
  source_ref_id uuid,
  total numeric(14,2) NOT NULL DEFAULT 0,
  finalized_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX invoices_invoice_uq ON reporting.invoices (tenant_id, invoice_id);
CREATE INDEX invoices_time_idx ON reporting.invoices (tenant_id, finalized_at);
SELECT app.enable_tenant_rls('reporting.invoices');

CREATE TABLE reporting.invoice_lines (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  invoice_id uuid NOT NULL,
  line_no integer NOT NULL,
  service_code text,
  description text NOT NULL,
  qty numeric(12,3) NOT NULL DEFAULT 1,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX invoice_lines_uq ON reporting.invoice_lines (tenant_id, invoice_id, line_no);
SELECT app.enable_tenant_rls('reporting.invoice_lines');

CREATE TABLE reporting.payments (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  event_id uuid NOT NULL,
  invoice_id uuid,
  patient_id uuid,
  facility_id uuid,
  amount numeric(14,2) NOT NULL,
  mode text NOT NULL,
  received_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX payments_event_uq ON reporting.payments (tenant_id, event_id);
CREATE INDEX payments_time_idx ON reporting.payments (tenant_id, received_at);
CREATE INDEX payments_invoice_idx ON reporting.payments (tenant_id, invoice_id);
SELECT app.enable_tenant_rls('reporting.payments');

CREATE TABLE reporting.pharmacy_dispenses (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  event_id uuid NOT NULL,
  prescription_id uuid,
  invoice_id uuid,
  dispensed_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX pharmacy_dispenses_event_uq ON reporting.pharmacy_dispenses (tenant_id, event_id);
CREATE INDEX pharmacy_dispenses_time_idx ON reporting.pharmacy_dispenses (tenant_id, dispensed_at);
SELECT app.enable_tenant_rls('reporting.pharmacy_dispenses');
