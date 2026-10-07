-- radiology: modalities, test master, report templates, orders (worklist + schedule), versioned reports.
-- All tables live in the radiology schema and are tenant-isolated with RLS.

-- ---------- modalities (machines / rooms) ----------

CREATE TABLE radiology.modalities (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  code text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('XR', 'CT', 'MR', 'US', 'MG', 'DX', 'RF', 'NM', 'ECHO', 'OTHER')),
  facility_id uuid,
  room text,
  ae_title text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id)
);
CREATE UNIQUE INDEX modalities_code_uq ON radiology.modalities (tenant_id, code);
SELECT app.enable_tenant_rls('radiology.modalities');
SELECT app.enable_updated_at('radiology.modalities');

-- ---------- report templates ----------

CREATE TABLE radiology.templates (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  name text NOT NULL,
  modality_id uuid,
  technique text,
  findings text,
  impression text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, modality_id) REFERENCES radiology.modalities (tenant_id, id)
);
CREATE UNIQUE INDEX templates_name_uq ON radiology.templates (tenant_id, lower(name));
SELECT app.enable_tenant_rls('radiology.templates');
SELECT app.enable_updated_at('radiology.templates');

-- ---------- test (study) master ----------

CREATE TABLE radiology.tests (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  code text NOT NULL,
  name text NOT NULL,
  modality_id uuid NOT NULL,
  body_part text,
  service_code text,
  price numeric(14,2) CHECK (price >= 0),
  tax_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 28),
  duration_minutes integer NOT NULL DEFAULT 15 CHECK (duration_minutes BETWEEN 5 AND 480),
  contrast boolean NOT NULL DEFAULT false,
  preparation text,
  default_template_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, modality_id) REFERENCES radiology.modalities (tenant_id, id),
  FOREIGN KEY (tenant_id, default_template_id) REFERENCES radiology.templates (tenant_id, id)
);
CREATE UNIQUE INDEX tests_code_uq ON radiology.tests (tenant_id, code);
CREATE INDEX tests_name_idx ON radiology.tests (tenant_id, lower(name));
SELECT app.enable_tenant_rls('radiology.tests');
SELECT app.enable_updated_at('radiology.tests');
SELECT app.enable_audit('radiology.tests');

-- ---------- orders: worklist + schedule ----------

CREATE TABLE radiology.orders (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  order_no text NOT NULL,
  facility_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  -- Patient snapshot for the worklist and the printed report.
  patient_name text NOT NULL,
  patient_uhid text NOT NULL,
  patient_gender text NOT NULL,
  patient_dob date,
  patient_mobile text,
  test_id uuid,
  test_code text,
  study_name text NOT NULL,
  modality_id uuid,
  priority text NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine', 'urgent', 'stat')),
  status text NOT NULL DEFAULT 'ordered'
    CHECK (status IN ('ordered', 'scheduled', 'in_progress', 'acquired', 'reported', 'finalized', 'cancelled')),
  source text NOT NULL DEFAULT 'desk' CHECK (source IN ('emr', 'desk')),
  encounter_id uuid,
  emr_order_id uuid,
  referring_doctor_id uuid,
  referring_doctor_name text,
  clinical_notes text,
  scheduled_at timestamptz,
  scheduled_end timestamptz,
  started_at timestamptz,
  acquired_at timestamptz,
  performed_by uuid,
  study_uid text,
  images_url text,
  tech_notes text,
  invoice_id uuid,
  invoice_no text,
  cancel_reason text,
  cancelled_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CHECK (scheduled_end IS NULL OR scheduled_end > scheduled_at),
  CHECK (status <> 'scheduled' OR (scheduled_at IS NOT NULL AND modality_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  FOREIGN KEY (tenant_id, test_id) REFERENCES radiology.tests (tenant_id, id),
  FOREIGN KEY (tenant_id, modality_id) REFERENCES radiology.modalities (tenant_id, id),
  FOREIGN KEY (tenant_id, referring_doctor_id) REFERENCES iam.users (tenant_id, id)
);
CREATE UNIQUE INDEX orders_no_uq ON radiology.orders (tenant_id, order_no);
-- One radiology order per EMR order line (the encounter-signed event can arrive more than once).
CREATE UNIQUE INDEX orders_emr_order_uq ON radiology.orders (tenant_id, emr_order_id) WHERE emr_order_id IS NOT NULL;
CREATE INDEX orders_status_idx ON radiology.orders (tenant_id, status, created_at DESC);
CREATE INDEX orders_patient_idx ON radiology.orders (tenant_id, patient_id, created_at DESC);
CREATE INDEX orders_schedule_idx ON radiology.orders (tenant_id, modality_id, scheduled_at) WHERE scheduled_at IS NOT NULL;
SELECT app.enable_tenant_rls('radiology.orders');
SELECT app.enable_updated_at('radiology.orders');
SELECT app.enable_audit('radiology.orders');

-- ---------- reports: one row per version ----------

CREATE TABLE radiology.reports (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  order_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final', 'superseded')),
  template_id uuid,
  technique text,
  findings text NOT NULL,
  impression text NOT NULL,
  is_critical boolean NOT NULL DEFAULT false,
  amendment_reason text,
  author_id uuid,
  finalized_at timestamptz,
  finalized_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CHECK (status = 'draft' OR (finalized_at IS NOT NULL AND finalized_by IS NOT NULL)),
  CHECK (version = 1 OR amendment_reason IS NOT NULL),
  FOREIGN KEY (tenant_id, order_id) REFERENCES radiology.orders (tenant_id, id),
  FOREIGN KEY (tenant_id, template_id) REFERENCES radiology.templates (tenant_id, id),
  FOREIGN KEY (tenant_id, author_id) REFERENCES iam.users (tenant_id, id),
  FOREIGN KEY (tenant_id, finalized_by) REFERENCES iam.users (tenant_id, id)
);
CREATE UNIQUE INDEX reports_version_uq ON radiology.reports (tenant_id, order_id, version);
-- At most one open draft per order.
CREATE UNIQUE INDEX reports_one_draft_uq ON radiology.reports (tenant_id, order_id) WHERE status = 'draft';
SELECT app.enable_tenant_rls('radiology.reports');
SELECT app.enable_updated_at('radiology.reports');
SELECT app.enable_audit('radiology.reports');

-- A finalized report is a signed medical record: its content never changes. The only allowed change is
-- final -> superseded when an amended version is finalized. Final and superseded rows cannot be deleted.
CREATE OR REPLACE FUNCTION radiology.lock_final_report() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'finalized radiology reports cannot be deleted' USING ERRCODE = 'P0001', HINT = 'radiology_report_locked';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'superseded'
     OR (OLD.status = 'final' AND (
          NEW.status <> 'superseded'
          OR (NEW.order_id, NEW.version, NEW.template_id, NEW.technique, NEW.findings, NEW.impression, NEW.is_critical,
              NEW.amendment_reason, NEW.author_id, NEW.finalized_at, NEW.finalized_by, NEW.created_at)
             IS DISTINCT FROM
             (OLD.order_id, OLD.version, OLD.template_id, OLD.technique, OLD.findings, OLD.impression, OLD.is_critical,
              OLD.amendment_reason, OLD.author_id, OLD.finalized_at, OLD.finalized_by, OLD.created_at))) THEN
    RAISE EXCEPTION 'radiology report % is finalized and cannot be changed', OLD.id USING ERRCODE = 'P0001', HINT = 'radiology_report_locked';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER radiology_lock_final_report BEFORE UPDATE OR DELETE ON radiology.reports
  FOR EACH ROW EXECUTE FUNCTION radiology.lock_final_report();
