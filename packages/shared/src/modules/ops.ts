import { z } from 'zod';
import { defineModule } from '../manifest';
import { patchSchema } from '../patch';
import {
  blankToUndefined,
  datesInOrder,
  indianMobile,
  isoDate as calendarDate,
  isoDateTime,
  money as moneyField,
  pastOrTodayDate,
  requiredText,
  todayIso,
  todayOrFutureDate,
} from '../validation';

/**
 * Facility Services: permissions and API contracts (Zod schemas + types).
 * Owned by the "ops" workstream. Covers biomedical assets & maintenance, CSSD, linen & laundry,
 * ambulance, diet kitchen and housekeeping. Dates are 'YYYY-MM-DD', timestamps ISO 8601, money in rupees.
 */
export const opsModule = defineModule({
  key: 'ops',
  name: 'Facility Services',
  permissions: [
    { key: 'ops.asset.read', description: 'View biomedical equipment, maintenance work orders and due PM/calibration' },
    { key: 'ops.asset.manage', description: 'Add and edit equipment, schedule PM and close maintenance work orders' },
    { key: 'ops.asset.report', description: 'Report an equipment breakdown' },
    { key: 'ops.cssd.read', description: 'View CSSD instrument sets, sterilization cycles and issues' },
    { key: 'ops.cssd.manage', description: 'Run sterilization cycles and issue or receive instrument sets' },
    { key: 'ops.linen.read', description: 'View linen stock and movements' },
    { key: 'ops.linen.manage', description: 'Record linen issue, soiled collection and laundry movements' },
    { key: 'ops.ambulance.read', description: 'View ambulances and trips' },
    { key: 'ops.ambulance.manage', description: 'Manage ambulances, book and dispatch trips' },
    { key: 'ops.diet.read', description: 'View diet orders and the kitchen sheet' },
    { key: 'ops.diet.order', description: 'Order or stop a patient diet' },
    { key: 'ops.diet.serve', description: 'Mark meals prepared and delivered (kitchen)' },
    { key: 'ops.housekeeping.read', description: 'View housekeeping tasks' },
    { key: 'ops.housekeeping.request', description: 'Raise a housekeeping request' },
    { key: 'ops.housekeeping.manage', description: 'Assign, complete and verify housekeeping tasks' },
  ],
  grants: {
    hospital_admin: [
      'ops.asset.read', 'ops.asset.manage', 'ops.asset.report', 'ops.cssd.read', 'ops.cssd.manage', 'ops.linen.read',
      'ops.linen.manage', 'ops.ambulance.read', 'ops.ambulance.manage', 'ops.diet.read', 'ops.diet.order', 'ops.diet.serve',
      'ops.housekeeping.read', 'ops.housekeeping.request', 'ops.housekeeping.manage',
    ],
    owner: ['ops.asset.read', 'ops.cssd.read', 'ops.linen.read', 'ops.ambulance.read', 'ops.diet.read', 'ops.housekeeping.read'],
    quality_manager: ['ops.asset.read', 'ops.cssd.read', 'ops.linen.read', 'ops.ambulance.read', 'ops.diet.read', 'ops.housekeeping.read'],
    nurse: [
      'ops.asset.read', 'ops.asset.report', 'ops.cssd.read', 'ops.linen.read', 'ops.linen.manage', 'ops.diet.read',
      'ops.diet.order', 'ops.housekeeping.read', 'ops.housekeeping.request',
    ],
    doctor: ['ops.asset.report', 'ops.diet.read', 'ops.diet.order', 'ops.housekeeping.request'],
    receptionist: ['ops.ambulance.read', 'ops.ambulance.manage', 'ops.housekeeping.read', 'ops.housekeeping.request'],
    store_keeper: ['ops.asset.read', 'ops.cssd.read', 'ops.cssd.manage', 'ops.linen.read', 'ops.linen.manage'],
    lab_technician: ['ops.asset.report', 'ops.housekeeping.request'],
    radiologist: ['ops.asset.report', 'ops.housekeeping.request'],
    billing_clerk: ['ops.ambulance.read'],
  },
});

// ---------- shared bits ----------

const isoDate = calendarDate;
const text = (max: number, label = 'a value') => requiredText(label, max);
const optionalText = (max: number) => z.string().trim().max(max, `Enter at most ${max} characters`).optional();
const money = moneyField(99_999_999.99);
const optionalDate = blankToUndefined(isoDate.optional());
const mobile = indianMobile;
/** An odometer reading in km. */
const odometer = (label: string) =>
  z.coerce.number({ error: `Enter the ${label}` }).int(`${label} must be whole km`).min(0, `${label} cannot be negative`).max(9_999_999, `${label} is too large`);
const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

// =====================================================================
// Biomedical assets & maintenance
// =====================================================================

export const ASSET_CATEGORIES = ['monitoring', 'life_support', 'imaging', 'laboratory', 'surgical', 'sterilization', 'therapy', 'general', 'other'] as const;
export const ASSET_STATUSES = ['in_service', 'under_maintenance', 'out_of_service', 'condemned'] as const;
export const ASSET_CRITICALITY = ['low', 'medium', 'high'] as const;
export const WORK_ORDER_TYPES = ['breakdown', 'preventive', 'calibration'] as const;
export const WORK_ORDER_STATUSES = ['open', 'in_progress', 'completed', 'cancelled'] as const;

export type AssetCategory = (typeof ASSET_CATEGORIES)[number];
export type AssetStatus = (typeof ASSET_STATUSES)[number];
export type AssetCriticality = (typeof ASSET_CRITICALITY)[number];
export type WorkOrderType = (typeof WORK_ORDER_TYPES)[number];
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

const assetFields = z.object({
  name: text(200, 'the equipment name'),
  category: z.enum(ASSET_CATEGORIES).default('general'),
  criticality: z.enum(ASSET_CRITICALITY).default('medium'),
  make: optionalText(100),
  model: optionalText(100),
  serialNo: optionalText(100),
  location: optionalText(200),
  departmentId: blankToUndefined(z.uuid({ error: 'Pick a valid department' }).optional()),
  purchaseDate: blankToUndefined(pastOrTodayDate('Purchase date').optional()),
  purchaseCost: blankToUndefined(money.optional()),
  vendor: optionalText(200),
  warrantyUntil: optionalDate,
  amcVendor: optionalText(200),
  amcUntil: optionalDate,
  /** Preventive maintenance every N days (0 or empty = no PM schedule). */
  pmIntervalDays: blankToUndefined(
    z.coerce.number().int('PM interval must be whole days').min(0, 'PM interval cannot be negative').max(3650, 'PM interval can be at most 3650 days').optional(),
  ),
  nextPmDue: optionalDate,
  calibrationDue: optionalDate,
  notes: optionalText(1000),
});

/** Warranty and AMC end dates cannot be before the purchase date (the API also checks edits against the saved record). */
export function assetDateIssues(a: { purchaseDate?: string | null; warrantyUntil?: string | null; amcUntil?: string | null }): { path: string; message: string }[] {
  const out: { path: string; message: string }[] = [];
  if (!datesInOrder(a.purchaseDate, a.warrantyUntil)) out.push({ path: 'warrantyUntil', message: 'Warranty end date is before the purchase date' });
  if (!datesInOrder(a.purchaseDate, a.amcUntil)) out.push({ path: 'amcUntil', message: 'AMC end date is before the purchase date' });
  return out;
}
const checkAssetDates = (a: Parameters<typeof assetDateIssues>[0], ctx: z.RefinementCtx) => {
  for (const i of assetDateIssues(a)) ctx.addIssue({ code: 'custom', path: [i.path], message: i.message });
};

export const assetInputSchema = assetFields.superRefine(checkAssetDates);
export type AssetInput = z.input<typeof assetInputSchema>;

// patchSchema, not .partial(): Zod 4 keeps defaults inside .partial(), so a partial update would reset them.
export const updateAssetSchema = patchSchema(assetFields).extend({
  /** Only out_of_service <-> in_service and condemned are set by hand; maintenance status follows work orders. */
  status: z.enum(['in_service', 'out_of_service', 'condemned']).optional(),
}).superRefine(checkAssetDates);
export type UpdateAsset = z.input<typeof updateAssetSchema>;

export interface Asset {
  id: string;
  code: string;
  facilityId: string;
  name: string;
  category: AssetCategory;
  criticality: AssetCriticality;
  status: AssetStatus;
  make: string | null;
  model: string | null;
  serialNo: string | null;
  location: string | null;
  departmentId: string | null;
  purchaseDate: string | null;
  purchaseCost: number | null;
  vendor: string | null;
  warrantyUntil: string | null;
  amcVendor: string | null;
  amcUntil: string | null;
  pmIntervalDays: number | null;
  nextPmDue: string | null;
  calibrationDue: string | null;
  notes: string | null;
  openWorkOrders: number;
  createdAt: string;
  updatedAt: string;
}

export const assetQuerySchema = listQuery.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  category: z.enum(ASSET_CATEGORIES).optional(),
  /** Only assets with PM, calibration, warranty or AMC due within N days (or overdue). */
  dueWithinDays: z.coerce.number().int().min(0).max(365).optional(),
});
export type AssetQuery = Partial<z.input<typeof assetQuerySchema>>;

export const createWorkOrderSchema = z.object({
  assetId: z.uuid({ error: 'Pick the equipment' }),
  type: z.enum(WORK_ORDER_TYPES).default('breakdown'),
  problem: text(1000, 'the problem'),
  priority: z.enum(['low', 'normal', 'urgent']).default('normal'),
});
export type CreateWorkOrder = z.input<typeof createWorkOrderSchema>;

export const updateWorkOrderSchema = z.object({
  status: z.enum(['in_progress', 'completed', 'cancelled']),
  assignedTo: optionalText(200),
  resolution: optionalText(2000),
  cost: blankToUndefined(money.optional()),
  /** For calibration work orders: next calibration due date once completed. */
  nextCalibrationDue: blankToUndefined(todayOrFutureDate('Next calibration due date').optional()),
});
export type UpdateWorkOrder = z.input<typeof updateWorkOrderSchema>;

export interface WorkOrder {
  id: string;
  number: string;
  assetId: string;
  assetCode: string;
  assetName: string;
  facilityId: string;
  type: WorkOrderType;
  priority: 'low' | 'normal' | 'urgent';
  status: WorkOrderStatus;
  problem: string;
  assignedTo: string | null;
  resolution: string | null;
  cost: number | null;
  reportedBy: string | null;
  reportedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** Minutes between report and completion (breakdowns only). */
  downtimeMinutes: number | null;
}

export const workOrderQuerySchema = listQuery.extend({
  assetId: z.uuid().optional(),
  status: z.enum(WORK_ORDER_STATUSES).optional(),
  type: z.enum(WORK_ORDER_TYPES).optional(),
  open: z.enum(['true', 'false']).optional(),
});
export type WorkOrderQuery = Partial<z.input<typeof workOrderQuerySchema>>;

/** Event `ops.asset.breakdown_reported`. */
export type AssetBreakdownReportedEvent = {
  workOrderId: string;
  assetId: string;
  assetName: string;
  facilityId: string;
  criticality: AssetCriticality;
};

// =====================================================================
// CSSD
// =====================================================================

export const CSSD_SET_STATUSES = ['dirty', 'sterilizing', 'sterile', 'issued'] as const;
export const CSSD_METHODS = ['steam', 'eto', 'plasma', 'dry_heat'] as const;
export const CSSD_CYCLE_STATUSES = ['running', 'passed', 'failed'] as const;
export type CssdSetStatus = (typeof CSSD_SET_STATUSES)[number];
export type CssdMethod = (typeof CSSD_METHODS)[number];
export type CssdCycleStatus = (typeof CSSD_CYCLE_STATUSES)[number];

export const cssdSetInputSchema = z.object({
  name: text(200, 'the set name'),
  department: optionalText(100),
  /** Instruments in the set, e.g. ["Artery forceps x4", "Scissors x2"]. */
  contents: z.array(text(200, 'the instrument')).max(200, 'A set can list at most 200 instruments').default([]),
  /** Days a sterile pack stays usable. */
  shelfLifeDays: z.coerce
    .number({ error: 'Enter the shelf life in days' })
    .int('Shelf life must be whole days')
    .min(1, 'Shelf life must be at least 1 day')
    .max(365, 'Shelf life can be at most 365 days')
    .default(30),
  isActive: z.boolean().optional(),
});
export type CssdSetInput = z.input<typeof cssdSetInputSchema>;
export const updateCssdSetSchema = patchSchema(cssdSetInputSchema).extend({ department: optionalText(100).nullable() });
export type UpdateCssdSet = z.input<typeof updateCssdSetSchema>;

export interface CssdSet {
  id: string;
  code: string;
  facilityId: string;
  name: string;
  department: string | null;
  contents: string[];
  shelfLifeDays: number;
  status: CssdSetStatus;
  /** Set when sterile: the pack must be re-processed after this time. */
  sterileUntil: string | null;
  expired: boolean;
  lastCycleId: string | null;
  issuedTo: string | null;
  isActive: boolean;
  updatedAt: string;
}

export const startCycleSchema = z.object({
  sterilizer: text(100, 'the sterilizer'),
  method: z.enum(CSSD_METHODS).default('steam'),
  setIds: z.array(z.uuid()).min(1, 'Pick at least one set').max(200, 'At most 200 sets in one load'),
  temperatureC: blankToUndefined(
    z.coerce.number({ error: 'Enter the temperature' }).min(0, 'Temperature cannot be negative').max(300, 'Temperature can be at most 300 °C').optional(),
  ),
  pressure: optionalText(50),
});
export type StartCycle = z.input<typeof startCycleSchema>;

export const completeCycleSchema = z.object({
  /** Chemical indicator (Bowie-Dick / strip) passed. */
  chemicalIndicatorPassed: z.boolean(),
  /** Biological indicator, if one was run with this load. */
  biologicalIndicatorPassed: z.boolean().optional(),
  notes: optionalText(1000),
});
export type CompleteCycle = z.input<typeof completeCycleSchema>;

export interface CssdCycle {
  id: string;
  number: string;
  facilityId: string;
  sterilizer: string;
  method: CssdMethod;
  status: CssdCycleStatus;
  temperatureC: number | null;
  pressure: string | null;
  chemicalIndicatorPassed: boolean | null;
  biologicalIndicatorPassed: boolean | null;
  notes: string | null;
  startedAt: string;
  completedAt: string | null;
  sets: { setId: string; code: string; name: string }[];
}

export const issueSetSchema = z.object({
  setId: z.uuid({ error: 'Pick the set' }),
  issuedTo: text(200, 'who it is issued to'),
  /** Patient the instruments were used on, for recall tracing. */
  patientId: z.uuid().optional(),
});
export type IssueSet = z.input<typeof issueSetSchema>;

export const returnSetSchema = z.object({ notes: optionalText(500) });
export type ReturnSet = z.input<typeof returnSetSchema>;

export interface CssdIssue {
  id: string;
  setId: string;
  setCode: string;
  setName: string;
  cycleId: string | null;
  cycleNumber: string | null;
  issuedTo: string;
  patientId: string | null;
  issuedAt: string;
  returnedAt: string | null;
  notes: string | null;
}

/** Event `ops.cssd.cycle_failed` (sets in the load go back to dirty). */
export type CssdCycleFailedEvent = {
  cycleId: string;
  number: string;
  facilityId: string;
  setIds: string[];
};

// =====================================================================
// Linen & laundry
// =====================================================================

/**
 * Linen moves between four pools per item: clean store -> in use (ward) -> soiled -> at laundry -> clean store.
 *  stock_in: new linen into the clean store; issue: clean -> ward; collect: ward -> soiled;
 *  laundry_out: soiled -> laundry; laundry_in: laundry -> clean; condemn: removed from soiled or clean.
 */
export const LINEN_TXN_KINDS = ['stock_in', 'issue', 'collect', 'laundry_out', 'laundry_in', 'condemn'] as const;
export type LinenTxnKind = (typeof LINEN_TXN_KINDS)[number];

export const linenItemInputSchema = z.object({
  name: text(100, 'the item name'),
  /** Minimum clean stock to keep; the stock screen flags items below it. */
  parLevel: z.coerce.number().int('Par level must be a whole number').min(0, 'Par level cannot be negative').max(100000, 'Par level can be at most 1,00,000').default(0),
  isActive: z.boolean().optional(),
});
export type LinenItemInput = z.input<typeof linenItemInputSchema>;
export const updateLinenItemSchema = patchSchema(linenItemInputSchema);
export type UpdateLinenItem = z.input<typeof updateLinenItemSchema>;

export interface LinenItem {
  id: string;
  name: string;
  parLevel: number;
  isActive: boolean;
}

export interface LinenStock {
  itemId: string;
  name: string;
  parLevel: number;
  clean: number;
  inUse: number;
  soiled: number;
  atLaundry: number;
  condemned: number;
  belowPar: boolean;
}

export const linenTxnInputSchema = z.object({
  itemId: z.uuid({ error: 'Pick the linen item' }),
  kind: z.enum(LINEN_TXN_KINDS),
  qty: z.coerce.number({ error: 'Enter the number of pieces' }).int('Pieces must be a whole number').min(1, 'Enter at least 1 piece').max(100000, 'At most 1,00,000 pieces at a time'),
  /** Ward / location for issue and collect. */
  location: optionalText(100),
  /** For condemn: which pool the pieces come out of. */
  fromPool: z.enum(['clean', 'soiled']).optional(),
  reference: optionalText(100),
  notes: optionalText(500),
});
export type LinenTxnInput = z.input<typeof linenTxnInputSchema>;

export interface LinenTxn {
  id: string;
  itemId: string;
  itemName: string;
  kind: LinenTxnKind;
  qty: number;
  location: string | null;
  fromPool: 'clean' | 'soiled' | null;
  reference: string | null;
  notes: string | null;
  createdAt: string;
}

export const linenTxnQuerySchema = listQuery.extend({
  itemId: z.uuid().optional(),
  kind: z.enum(LINEN_TXN_KINDS).optional(),
});
export type LinenTxnQuery = Partial<z.input<typeof linenTxnQuerySchema>>;

// =====================================================================
// Ambulance
// =====================================================================

export const VEHICLE_TYPES = ['bls', 'als', 'patient_transport', 'mortuary'] as const;
export const VEHICLE_STATUSES = ['available', 'on_trip', 'maintenance', 'inactive'] as const;
export const TRIP_KINDS = ['emergency_pickup', 'inter_hospital_transfer', 'drop_home', 'other'] as const;
export const TRIP_STATUSES = ['requested', 'dispatched', 'patient_onboard', 'completed', 'cancelled'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];
export type TripKind = (typeof TRIP_KINDS)[number];
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const vehicleInputSchema = z.object({
  registrationNo: z
    .string({ error: 'Enter the registration number' })
    .trim()
    .toUpperCase()
    .min(4, 'Registration number needs at least 4 characters')
    .max(20, 'Registration number can be at most 20 characters')
    .regex(/^[A-Z0-9][A-Z0-9 -]*$/, 'Registration number can have letters, digits, spaces and - only'),
  type: z.enum(VEHICLE_TYPES).default('bls'),
  driverName: optionalText(100),
  driverMobile: blankToUndefined(mobile.optional()),
  /** Charge per km when billing a trip (0 = flat charge only). */
  ratePerKm: blankToUndefined(money.optional()),
  baseCharge: blankToUndefined(money.optional()),
  status: z.enum(['available', 'maintenance', 'inactive']).optional(),
});
export type VehicleInput = z.input<typeof vehicleInputSchema>;
export const updateVehicleSchema = patchSchema(vehicleInputSchema).extend({
  driverName: optionalText(100).nullable(),
  /** null clears the driver mobile; +91 / spaces are accepted like on create. */
  driverMobile: blankToUndefined(mobile.nullable().optional()),
});
export type UpdateVehicle = z.input<typeof updateVehicleSchema>;

export interface Vehicle {
  id: string;
  facilityId: string;
  registrationNo: string;
  type: VehicleType;
  status: VehicleStatus;
  driverName: string | null;
  driverMobile: string | null;
  ratePerKm: number;
  baseCharge: number;
}

export const createTripSchema = z.object({
  kind: z.enum(TRIP_KINDS).default('emergency_pickup'),
  patientId: blankToUndefined(z.uuid({ error: 'Pick a valid patient' }).optional()),
  /** Caller / patient name when the patient is not registered yet. */
  contactName: text(200, 'the contact name'),
  contactMobile: mobile,
  pickupAddress: text(500, 'the pickup address'),
  dropAddress: optionalText(500),
  notes: optionalText(1000),
  vehicleId: z.uuid().optional(),
});
export type CreateTrip = z.input<typeof createTripSchema>;

export const tripActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('dispatch'), vehicleId: z.uuid({ error: 'Pick an ambulance' }), odometerStart: blankToUndefined(odometer('Start reading').optional()) }),
  z.object({ action: z.literal('onboard') }),
  z.object({
    action: z.literal('complete'),
    odometerEnd: blankToUndefined(odometer('End reading').optional()),
    /** Distance in km if odometers are not used. */
    distanceKm: blankToUndefined(z.coerce.number({ error: 'Enter the distance in km' }).min(0, 'Distance cannot be negative').max(5000, 'Distance can be at most 5,000 km').optional()),
    /** Bill the patient for this trip through Billing (needs a registered patient). */
    bill: z.boolean().default(false),
    /** Override the computed charge. */
    charge: blankToUndefined(money.optional()),
  }),
  z.object({ action: z.literal('cancel'), reason: text(500, 'the reason for cancelling') }),
]);
export type TripAction = z.input<typeof tripActionSchema>;

export interface Trip {
  id: string;
  number: string;
  facilityId: string;
  kind: TripKind;
  status: TripStatus;
  patientId: string | null;
  contactName: string;
  contactMobile: string;
  pickupAddress: string;
  dropAddress: string | null;
  notes: string | null;
  vehicleId: string | null;
  vehicleRegistrationNo: string | null;
  odometerStart: number | null;
  odometerEnd: number | null;
  distanceKm: number | null;
  charge: number | null;
  invoiceId: string | null;
  cancelReason: string | null;
  requestedAt: string;
  dispatchedAt: string | null;
  onboardAt: string | null;
  completedAt: string | null;
}

export const tripQuerySchema = listQuery.extend({
  status: z.enum(TRIP_STATUSES).optional(),
  active: z.enum(['true', 'false']).optional(),
  date: isoDate.optional(),
});
export type TripQuery = Partial<z.input<typeof tripQuerySchema>>;

/** Event `ops.trip.completed`. */
export type TripCompletedEvent = {
  tripId: string;
  patientId: string | null;
  facilityId: string;
  invoiceId: string | null;
  distanceKm: number | null;
};

// =====================================================================
// Diet kitchen
// =====================================================================

export const DIET_TYPES = ['normal', 'soft', 'liquid', 'clear_liquid', 'diabetic', 'renal', 'cardiac', 'low_salt', 'high_protein', 'npo'] as const;
export const MEALS = ['breakfast', 'lunch', 'evening_snack', 'dinner'] as const;
export const MEAL_STATUSES = ['prepared', 'delivered', 'refused', 'skipped'] as const;
export type DietType = (typeof DIET_TYPES)[number];
export type Meal = (typeof MEALS)[number];
export type MealStatus = (typeof MEAL_STATUSES)[number];

export const dietOrderInputSchema = z
  .object({
    patientId: z.uuid({ error: 'Pick the patient' }),
    /** Ward / bed until IPD admissions land, e.g. "Ward 2 / Bed 14". */
    location: text(100, 'the ward / bed'),
    dietType: z.enum(DIET_TYPES),
    vegetarian: z.boolean().default(true),
    instructions: optionalText(500),
    /** Defaults to today; a new diet cannot start in the past. */
    startDate: blankToUndefined(todayOrFutureDate('Start date').optional()),
    endDate: optionalDate,
  })
  .refine((o) => datesInOrder(o.startDate ?? todayIso(), o.endDate), { message: 'End date is before the start date', path: ['endDate'] });
export type DietOrderInput = z.input<typeof dietOrderInputSchema>;

export interface DietOrder {
  id: string;
  facilityId: string;
  patientId: string;
  patientName: string;
  patientUhid: string;
  location: string;
  dietType: DietType;
  vegetarian: boolean;
  instructions: string | null;
  allergies: string[];
  startDate: string;
  endDate: string | null;
  status: 'active' | 'stopped';
  orderedBy: string | null;
  createdAt: string;
}

export const dietOrderQuerySchema = listQuery.extend({
  status: z.enum(['active', 'stopped']).optional(),
  patientId: z.uuid().optional(),
});
export type DietOrderQuery = Partial<z.input<typeof dietOrderQuerySchema>>;

export const kitchenSheetQuerySchema = z.object({ date: isoDate.optional(), meal: z.enum(MEALS) });
export type KitchenSheetQuery = z.input<typeof kitchenSheetQuerySchema>;

export interface KitchenSheet {
  date: string;
  meal: Meal;
  /** Count of trays per diet type (NPO excluded). */
  counts: { dietType: DietType; vegetarian: number; nonVegetarian: number }[];
  rows: (Pick<DietOrder, 'id' | 'patientName' | 'patientUhid' | 'location' | 'dietType' | 'vegetarian' | 'instructions' | 'allergies'> & {
    mealStatus: MealStatus | null;
  })[];
}

export const markMealSchema = z.object({
  orderId: z.uuid(),
  /** Meals are marked for today or earlier, never ahead. */
  date: blankToUndefined(pastOrTodayDate('Meal date').optional()),
  meal: z.enum(MEALS),
  status: z.enum(MEAL_STATUSES),
  notes: optionalText(300),
});
export type MarkMeal = z.input<typeof markMealSchema>;

// =====================================================================
// Housekeeping
// =====================================================================

export const HK_KINDS = ['routine', 'discharge_clean', 'spill', 'terminal_clean', 'washroom', 'pest_control', 'other'] as const;
export const HK_PRIORITIES = ['low', 'normal', 'urgent'] as const;
export const HK_STATUSES = ['pending', 'in_progress', 'done', 'verified', 'cancelled'] as const;
export type HkKind = (typeof HK_KINDS)[number];
export type HkPriority = (typeof HK_PRIORITIES)[number];
export type HkStatus = (typeof HK_STATUSES)[number];

export const createHkTaskSchema = z.object({
  location: text(200, 'the location'),
  kind: z.enum(HK_KINDS).default('routine'),
  priority: z.enum(HK_PRIORITIES).default('normal'),
  description: optionalText(1000),
  assignedTo: optionalText(100),
  /** Defaults by priority; a due time given by hand cannot be in the past. */
  dueAt: blankToUndefined(isoDateTime.refine((v) => Date.parse(v) >= Date.now() - 5 * 60_000, 'Due time cannot be in the past').optional()),
});
export type CreateHkTask = z.input<typeof createHkTaskSchema>;

export const updateHkTaskSchema = z.object({
  status: z.enum(['in_progress', 'done', 'verified', 'cancelled']).optional(),
  assignedTo: optionalText(100),
  remarks: optionalText(500),
  /** Task details: editable only while the task is pending or in progress. */
  location: text(200).optional(),
  kind: z.enum(HK_KINDS).optional(),
  priority: z.enum(HK_PRIORITIES).optional(),
  description: optionalText(1000).nullable(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
export type UpdateHkTask = z.input<typeof updateHkTaskSchema>;

export interface HkTask {
  id: string;
  number: string;
  facilityId: string;
  location: string;
  kind: HkKind;
  priority: HkPriority;
  status: HkStatus;
  description: string | null;
  assignedTo: string | null;
  remarks: string | null;
  requestedBy: string | null;
  dueAt: string | null;
  overdue: boolean;
  startedAt: string | null;
  doneAt: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  createdAt: string;
}

export const hkTaskQuerySchema = listQuery.extend({
  status: z.enum(HK_STATUSES).optional(),
  open: z.enum(['true', 'false']).optional(),
  kind: z.enum(HK_KINDS).optional(),
});
export type HkTaskQuery = Partial<z.input<typeof hkTaskQuerySchema>>;

// =====================================================================
// Dashboard
// =====================================================================

export interface OpsSummary {
  assets: { total: number; underMaintenance: number; outOfService: number; pmDue: number; calibrationDue: number; openBreakdowns: number };
  cssd: { sterile: number; expired: number; issued: number; dirty: number; cyclesToday: number; failedToday: number };
  linen: { belowPar: number; atLaundry: number };
  ambulance: { available: number; activeTrips: number; tripsToday: number };
  diet: { activeOrders: number };
  housekeeping: { pending: number; inProgress: number; overdue: number; awaitingVerification: number };
}
