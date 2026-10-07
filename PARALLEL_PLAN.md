# Parallel build plan

How 10 threads build HMS Release 1 at the same time without stepping on each other, and how the
next 10 (Release 2/3 modules) follow. Read this whole file before writing code.

## 0. Getting started (every thread)

1. Get the code (GitHub repo once connected; until then `git clone /mnt/project-files/hms/hms.git hms`).
2. Branch: `feat/<module-key>` (e.g. `feat/billing`). One PR per meaningful slice; keep PRs small and merge often.
3. `./scripts/local-infra.sh` (no Docker) or `docker compose up -d` + `pnpm db:migrate && pnpm db:seed`.
4. `pnpm dev`. Log in as hospital `demo`, `admin@demo.hms` / `Demo@12345`.
5. Before every PR: `pnpm build && pnpm typecheck && pnpm lint && pnpm db:migrate && pnpm db:seed && pnpm test`.
6. Copy the patterns in `apps/api/src/modules/patients` (controller → service → repository, `db.tx`, Zod pipe,
   `@RequirePermissions`, outbox event) and `apps/web/src/app/(app)/patients` (list, form, detail).

## 1. Golden rules

1. **Stay in your folders.** Each workstream below lists exactly what it owns. Everything else is read-only.
2. **Foundation files are frozen** (section 2). If you truly need a change there, ask in your thread; the
   coordinator routes it to one foundation owner. Never edit them in a module PR.
3. **Every module is pre-registered.** Your API module, Drizzle schema file, shared contract file, API-client
   file, web nav file, web route folder and mobile module file already exist and are already wired into the
   registries. You fill them in; you never touch the registries.
4. **Database:**
   - New migration: `pnpm db:new <module> <what>` → `packages/db/migrations/<timestamp>_<module>_<what>.sql`.
     Never edit an applied migration; write a new one. Parallel branches merge in any order.
   - Tables go in your Postgres schema (table below). Prefix exported Drizzle tables with the module key
     (`billingInvoices`). Keep the Drizzle file and the SQL in sync; `pnpm test` checks it.
   - Every tenant table: `tenant_id uuid not null`, `id uuid default app.uuid_v7()`, `primary key (tenant_id, id)`,
     foreign keys include `tenant_id`, money is `numeric(14,2)`, statuses are `text` + `CHECK`, plus:
     `SELECT app.enable_tenant_rls('<schema>.<table>');` and, where it applies,
     `SELECT app.enable_updated_at(...)` and `SELECT app.enable_audit(...)` (clinical and financial records).
     The test suite fails if a `tenant_id` table has no RLS.
   - Facility-scoped rows carry `facility_id` and use `ctx.facilityId`.
   - Number series: `nextCounter(tx, '<module>.<series>')` + `formatSeries(prefix, n)`.
   - Never write to another module's tables. Read another module's data through its exported service; reading
     its tables directly is allowed only for `reports`.
5. **Permissions:** add to your manifest in `packages/shared/src/modules/<key>.ts` as `<key>.<resource>.<action>`
   and grant them to system roles there. `pnpm db:seed` loads them into every hospital.
6. **API:** routes live under `/api/v1/<your-resource>`; every route has `@RequirePermissions` unless `@Public()`.
   Inputs are Zod schemas from your shared file, parsed with `ZodPipe`. Errors use `AppError`/`notFound`/`conflict`
   from `common/errors`. All DB access goes through `DbService.tx()`.
7. **Events:** publish with `OutboxService.publish(tx, '<module>.<entity>.<event>', payload)` inside the same
   transaction. Subscribe with `EventBus.on(topic, handler)` in your module's `onModuleInit`; handlers run in the
   worker and must be idempotent. Payload types live in the publisher's shared file.
8. **Cross-module calls:** a module that others call exports a service from its Nest module (e.g.
   `BillingModule` exports `BillingService`); the caller imports that Nest module. The contracts in section 4
   are agreed now so both sides can build in parallel. Until the owner lands it, code against the interface and
   stub it in your tests.
9. **Dependencies:** avoid new packages. If you must add one, add it only to your app's `package.json`. On a
   `pnpm-lock.yaml` merge conflict, take main's lockfile and run `pnpm install`.
10. **Done means** API + web screens + permissions + migration + e2e tests (`apps/api/test/<key>.e2e.test.ts`)
    including one cross-hospital isolation test, all green.

## 2. Foundation-owned files (do not edit in module PRs)

- Root: `package.json`, `turbo.json`, `tsconfig.base.json`, `pnpm-workspace.yaml`, `.npmrc`, `docker-compose.yml`,
  `.github/**`, `infra/**`, `scripts/**`, `.env.example`
- `packages/shared/src/{index,common,roles,manifest,permissions}.ts`, `packages/shared/src/modules/{index,core}.ts`
- `packages/db/src/{client,counters,password,migrator,provision,seed,time,index}.ts`, `packages/db/src/schema/{_common,core,index}.ts`,
  `packages/db/src/cli/**`, `packages/db/migrations/20261007060000_core_init.sql`
- `packages/api-client/src/{index,http,core}.ts`
- `apps/api/src/{main,bootstrap,app.module,config,worker}.ts`, `apps/api/src/common/**`, `apps/api/src/modules/{index.ts,auth,patients,health}`
- `apps/web`: `src/app/{layout,providers,page}.tsx`, `src/app/login/**`, `src/app/(app)/{layout.tsx,dashboard,patients}`,
  `src/components/**`, `src/lib/**`, `src/modules/{index,types}.ts`, `src/modules/core/**`, config files
- `apps/mobile` belongs to the **mobile** workstream (W10), not to module threads.

## 3. Wave 1 — Release 1 (10 threads, start now)

Each module `<key>` owns all of these (already created, empty):

- `apps/api/src/modules/<key>/**`
- `packages/shared/src/modules/<key>.ts`
- `packages/db/src/schema/<key>.ts` and `packages/db/migrations/*_<key>_*.sql`
- `packages/api-client/src/modules/<key>.ts`
- `apps/web/src/app/(app)/<key>/**` and `apps/web/src/modules/<key>/**` (put your sidebar items in `nav.ts`)
- `apps/api/test/<key>*.test.ts`

| # | Key | Workstream | Postgres schema | Scope (Release 1) |
|---|-----|-----------|-----------------|-------------------|
| W1 | `frontoffice` | Front office & OPD queue | `clinical` (appointments, queue) | Appointments (book, reschedule, cancel, status machine + history), walk-ins, token queue per doctor/day, check-in, TV queue display page, duplicate-patient search on registration, patient merge, ABHA number capture. |
| W2 | `emr` | OPD / EMR doctor workspace | `clinical` (encounters…) | Doctor's day queue, encounter (vitals, complaints, history, exam, diagnosis ICD-10, notes as JSONB sections), e-prescription with favourites and allergy check, lab/radiology order lines (stored only), follow-up, certificates, sign & lock (immutable trigger), patient timeline API, printable Rx. |
| W3 | `billing` | Billing & masters for money | `billing` | Services master + price lists (effective dates) + tax rules + packages, OPD bills, charge engine, invoices (draft → final, immutable), payments (cash/UPI/card), receipts, refunds, credit notes, cash shift close, GST fields, UPI QR on bill, printable invoice. |
| W4 | `pharmacy` | Basic pharmacy & stock | `inventory` | Item master (drugs, HSN, GST), stores, batches (batch/expiry/MRP), append-only stock ledger, opening stock, GRN (simple, no PO yet), Rx dispense queue from EMR prescriptions, OTC sale, FEFO, returns, no-negative-stock, expiry alerts. Pharmacy bills go through `BillingService`. |
| W5 | `setup` | Hospital setup, staff & access | `setup` (+ owns later changes to `iam.*`, `setup.facilities`) | Setup wizard, hospital profile/letterhead/GSTIN, facilities CRUD, departments, specializations, staff profiles, doctor schedules & leaves, **users and roles admin** (invite, roles per facility, custom roles from the permission catalog, deactivate, reset password), number-series settings, print templates. |
| W6 | `platform` | SaaS platform & help desk | `platform` | Hospital signup (uses `provisionTenant` from `@hms/db`), plans, trial, subscriptions, entitlements (`@RequireEntitlement` guard exported from the platform module), limits, super-admin console (`apps/web/src/app/(app)/platform/**`, own `typ:'platform'` auth with `@Public()` + its own guard), announcements, in-app help, support tickets, onboarding checklist. |
| W7 | `notifications` | Messaging | `comms` | SMS/WhatsApp/email/push providers behind one interface (MSG91/Gupshup/SES/Expo push, with a console provider for dev), templates per hospital with variables, delivery log, opt-out, prepaid message-credit wallet (append-only ledger), BullMQ sending, `NotificationsService.send()`, event→template rules (appointment booked, bill paid…). |
| W8 | `reports` | Reports & MIS, owner summary | `reporting` | Read-only SQL views/materialized views over other modules' tables, dashboards (daily OPD count, collections, top services, doctor-wise revenue), owner daily summary API (used by the owner app and the 7 AM WhatsApp summary), CSV export. May read other schemas; never writes them. |
| W9 | `portal` | Patient portal | `portal` | Patient OTP login (`typ:'patient'` JWT, `@Public()` + own guard), patient accounts linked to `clinical.patients` across hospitals, family members, booking via `FrontofficeService`, view prescriptions/bills/reports via owners' services, online payment intent (Razorpay stub), feedback. Web pages at `apps/web/src/app/p/**` (public, outside the staff layout). |
| W10 | `mobile` | Expo apps | — | Owns all of `apps/mobile/**`. Doctor app lite (today's queue, patient timeline, write Rx) on W1/W2 APIs; owner summary app on W8; patient app shell on W9; staff app later. Uses only `@hms/api-client`. Push token registration endpoint is provided by W7. |

## 4. Agreed cross-module contracts (wave 1)

Owners implement these exactly; callers code against them now. Types go in the owner's shared file.

| Owner | Contract | Used by |
|-------|----------|---------|
| core (done) | `PatientsService.get(id)`, `GET /patients`, `POST /patients`; event `core.patient.registered {patientId, uhid}` | everyone |
| setup | `SetupService.listDoctors({facilityId?, departmentId?})` → `{userId, name, departmentId, specialization, consultationFee?}[]`; `SetupService.getDoctorSchedule(userId, date)` → slots; `GET /setup/doctors`, `GET /setup/departments` | frontoffice, emr, portal, reports, mobile |
| frontoffice | `FrontofficeService.book({patientId, doctorId, facilityId, slotStart, type})` → appointment; `GET /frontoffice/queue?doctorId&date`; events `frontoffice.appointment.booked/cancelled {appointmentId, patientId, doctorId, start}`, `frontoffice.visit.checked_in {visitId, appointmentId?, patientId, doctorId, facilityId, tokenNo}` | emr (starts encounter on check-in), billing (consultation fee), notifications, portal, mobile |
| emr | `GET /emr/queue?date` (doctor's checked-in patients), `GET /emr/patients/:id/timeline`; events `emr.encounter.signed {encounterId, patientId, doctorId}`, `emr.prescription.created {prescriptionId, patientId, lines:[{drugName, itemCode?, dose, frequency, days, qty}]}` | pharmacy (dispense queue), mobile, portal, reports |
| billing | `BillingService.createInvoice(tx, {patientId, facilityId, source:{module, refId}, lines:[{serviceCode?, itemId?, description, qty, unitPrice, taxRate, discount?}], payNow?: {mode, amount, ref?}})` → `{invoiceId, number, total, status}`; `BillingService.getServicePrice(serviceCode, payerId?)`; events `billing.invoice.finalized`, `billing.payment.received {invoiceId, patientId, amount, mode}` | frontoffice (consultation fee), pharmacy (sales), portal, reports, notifications |
| pharmacy | events `pharmacy.dispense.completed {prescriptionId, invoiceId}`, `pharmacy.stock.low {itemId, storeId, qty}` | reports, notifications |
| notifications | `NotificationsService.send(tx, {to:{patientId? , userId?, mobile?, email?}, template: string, data, channels?: ('sms'|'whatsapp'|'email'|'push')[]})`; `POST /notifications/devices` (push token) | any module, mobile |
| platform | `@RequireEntitlement('<moduleKey>')` decorator + guard exported from `apps/api/src/modules/platform`; `PlatformService.getPlan(tenantId)` | all modules (add the decorator once platform lands) |
| reports | `GET /reports/owner-summary?date` → `{opdVisits, newPatients, collections, pendingBills, topDoctors[], …}` | mobile owner app, notifications (7 AM summary) |
| portal | none consumed by others | — |

Event naming: `<module>.<entity>.<past-tense-verb>`. A module only publishes topics with its own prefix.

## 5. Wave 2 — Release 2/3 (start when wave 1 has merged its first PRs)

Same ownership pattern; stubs already exist for each key.

| Key | Workstream | Postgres schema | Scope |
|-----|-----------|-----------------|-------|
| `lab` | Laboratory (LIS) | `lab` | Test/panel master, ranges, sample barcode, collection, results, verification, critical alerts, report PDF, B2B. Consumes `emr` order lines. |
| `radiology` | Radiology (RIS) | `radiology` | Modalities, worklist, templates, versioned reports, PACS link. |
| `ipd` | IPD, nursing, ER, OT, discharge | `inpatient` | Wards/rooms/beds, admission + deposit, bed board, transfers, nursing notes, vitals, MAR, I/O, ER triage/MLC, OT schedule & records, discharge summary. Charges via `BillingService`. |
| `inventory` | Procurement & stores | `inventory` (procurement tables only; stock tables stay with pharmacy) | PR → PO → GRN, suppliers, quotations, transfers, indents, stock audits. Stock movements via `PharmacyService` stock-ledger API. |
| `insurance` | Insurance, TPA, PM-JAY, corporate | `insurance` | Payers, policies, pre-auth, claims, scheme packages, corporate credit. |
| `crm` | Referral & CRM | `crm` | Referrers, commission rules/statements, leads, camps, campaigns. |
| `hr` | HR & roster | `hr` | Roster, attendance, leave, payroll export, licence expiry alerts. |
| `quality` | Quality & NABH | `quality` | Incidents, HAI, audits, complaints, NABH docs. |
| `ops` | Facility services | `ops` | Biomedical assets, CSSD, linen, ambulance, diet kitchen. |
| `integrations` | ABDM & integrations | `integrations` | ABHA create/verify, Scan-and-Share, HIP/HIU, FHIR R4, webhooks/API keys. |

## 6. Coordination

- One thread per workstream key. A thread that needs something from another module asks in its own thread; the
  coordinator relays. Contract changes are added to section 4 by the coordinator, not by module threads.
- Merge order does not matter for migrations. Rebase on `main` daily.
- Known caveat: `apps/web` uses React 19.3 and `apps/mobile` uses React 19.2 (Expo SDK 57); both build fine with
  the hoisted layout. Do not add a root-level React override without checking both apps build.
