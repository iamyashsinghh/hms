import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ops as O, type Paginated } from '@hms/shared';
import { z } from 'zod';
import { Ctx, RequirePermissions } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/context/request-context';
import { forbidden } from '../../common/errors/errors';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { AmbulanceService } from './ambulance.service';
import { AssetsService } from './assets.service';
import { CssdService } from './cssd.service';
import { DietService } from './diet.service';
import { HousekeepingService } from './housekeeping.service';
import { LinenService } from './linen.service';
import { OpsService } from './ops.service';
import { RequireEntitlement } from '../platform';

type Out<S extends z.ZodType> = z.output<S>;
const READ_PERMS = ['ops.asset.read', 'ops.cssd.read', 'ops.linen.read', 'ops.ambulance.read', 'ops.diet.read', 'ops.housekeeping.read'];

const cssdSetQuery = z.object({ status: z.enum(O.CSSD_SET_STATUSES).optional(), q: z.string().trim().max(100).optional() });
const pageQuery = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) });
const issueQuery = z.object({ setId: z.uuid().optional(), cycleId: z.uuid().optional(), open: z.enum(['true', 'false']).optional() });

/** Every route needs the hospital's plan to include Facility Services (Growth and Enterprise). */
@Controller('ops')
@RequireEntitlement('ops')
export class OpsController {
  constructor(
    private readonly ops: OpsService,
    private readonly assets: AssetsService,
    private readonly cssd: CssdService,
    private readonly linen: LinenService,
    private readonly ambulance: AmbulanceService,
    private readonly diet: DietService,
    private readonly hk: HousekeepingService,
  ) {}

  /** Needs any one of the ops read permissions (checked here; the decorator only takes all-of lists). */
  @Get('summary')
  @RequirePermissions()
  summary(@Ctx() ctx: RequestContext): Promise<O.OpsSummary> {
    if (!READ_PERMS.some((p) => ctx.permissions.has(p))) throw forbidden();
    return this.ops.summary();
  }

  // ---------- assets ----------

  @Get('assets')
  @RequirePermissions('ops.asset.read')
  listAssets(@Query(new ZodPipe(O.assetQuerySchema)) q: Out<typeof O.assetQuerySchema>): Promise<Paginated<O.Asset>> {
    return this.assets.list(q);
  }

  @Get('assets/:id')
  @RequirePermissions('ops.asset.read')
  getAsset(@Param('id', ParseUUIDPipe) id: string): Promise<O.Asset> {
    return this.assets.get(id);
  }

  @Post('assets')
  @RequirePermissions('ops.asset.manage')
  createAsset(@Body(new ZodPipe(O.assetInputSchema)) body: Out<typeof O.assetInputSchema>): Promise<O.Asset> {
    return this.assets.create(body);
  }

  @Patch('assets/:id')
  @RequirePermissions('ops.asset.manage')
  updateAsset(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(O.updateAssetSchema)) body: Out<typeof O.updateAssetSchema>): Promise<O.Asset> {
    return this.assets.update(id, body);
  }

  @Get('work-orders')
  @RequirePermissions('ops.asset.read')
  listWorkOrders(@Query(new ZodPipe(O.workOrderQuerySchema)) q: Out<typeof O.workOrderQuerySchema>): Promise<Paginated<O.WorkOrder>> {
    return this.assets.listWorkOrders(q);
  }

  /** Breakdowns need ops.asset.report; PM and calibration need ops.asset.manage (checked in the service). */
  @Post('work-orders')
  @RequirePermissions()
  createWorkOrder(@Body(new ZodPipe(O.createWorkOrderSchema)) body: Out<typeof O.createWorkOrderSchema>): Promise<O.WorkOrder> {
    return this.assets.createWorkOrder(body);
  }

  @Patch('work-orders/:id')
  @RequirePermissions('ops.asset.manage')
  updateWorkOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(O.updateWorkOrderSchema)) body: Out<typeof O.updateWorkOrderSchema>,
  ): Promise<O.WorkOrder> {
    return this.assets.updateWorkOrder(id, body);
  }

  // ---------- CSSD ----------

  @Get('cssd/sets')
  @RequirePermissions('ops.cssd.read')
  listSets(@Query(new ZodPipe(cssdSetQuery)) q: Out<typeof cssdSetQuery>): Promise<O.CssdSet[]> {
    return this.cssd.listSets(q);
  }

  @Post('cssd/sets')
  @RequirePermissions('ops.cssd.manage')
  createSet(@Body(new ZodPipe(O.cssdSetInputSchema)) body: Out<typeof O.cssdSetInputSchema>): Promise<O.CssdSet> {
    return this.cssd.createSet(body);
  }

  @Patch('cssd/sets/:id')
  @RequirePermissions('ops.cssd.manage')
  updateSet(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(O.updateCssdSetSchema)) body: Out<typeof O.updateCssdSetSchema>,
  ): Promise<O.CssdSet> {
    return this.cssd.updateSet(id, body);
  }

  @Get('cssd/cycles')
  @RequirePermissions('ops.cssd.read')
  listCycles(@Query(new ZodPipe(pageQuery)) q: Out<typeof pageQuery>): Promise<Paginated<O.CssdCycle>> {
    return this.cssd.listCycles(q.page, q.pageSize);
  }

  @Post('cssd/cycles')
  @RequirePermissions('ops.cssd.manage')
  startCycle(@Body(new ZodPipe(O.startCycleSchema)) body: Out<typeof O.startCycleSchema>): Promise<O.CssdCycle> {
    return this.cssd.startCycle(body);
  }

  @Post('cssd/cycles/:id/complete')
  @HttpCode(200)
  @RequirePermissions('ops.cssd.manage')
  completeCycle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(O.completeCycleSchema)) body: Out<typeof O.completeCycleSchema>,
  ): Promise<O.CssdCycle> {
    return this.cssd.completeCycle(id, body);
  }

  @Get('cssd/issues')
  @RequirePermissions('ops.cssd.read')
  listIssues(@Query(new ZodPipe(issueQuery)) q: Out<typeof issueQuery>): Promise<O.CssdIssue[]> {
    return this.cssd.listIssues(q);
  }

  @Post('cssd/issues')
  @RequirePermissions('ops.cssd.manage')
  issueSet(@Body(new ZodPipe(O.issueSetSchema)) body: Out<typeof O.issueSetSchema>): Promise<O.CssdIssue> {
    return this.cssd.issue(body);
  }

  @Post('cssd/issues/:id/return')
  @HttpCode(200)
  @RequirePermissions('ops.cssd.manage')
  returnSet(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(O.returnSetSchema)) body: Out<typeof O.returnSetSchema>): Promise<O.CssdIssue> {
    return this.cssd.returnSet(id, body.notes);
  }

  // ---------- linen ----------

  @Get('linen/items')
  @RequirePermissions('ops.linen.read')
  linenItems(): Promise<O.LinenItem[]> {
    return this.linen.listItems();
  }

  @Post('linen/items')
  @RequirePermissions('ops.linen.manage')
  createLinenItem(@Body(new ZodPipe(O.linenItemInputSchema)) body: Out<typeof O.linenItemInputSchema>): Promise<O.LinenItem> {
    return this.linen.createItem(body);
  }

  @Patch('linen/items/:id')
  @RequirePermissions('ops.linen.manage')
  updateLinenItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(O.updateLinenItemSchema)) body: Out<typeof O.updateLinenItemSchema>,
  ): Promise<O.LinenItem> {
    return this.linen.updateItem(id, body);
  }

  @Get('linen/stock')
  @RequirePermissions('ops.linen.read')
  linenStock(): Promise<O.LinenStock[]> {
    return this.linen.stock();
  }

  @Get('linen/txns')
  @RequirePermissions('ops.linen.read')
  linenTxns(@Query(new ZodPipe(O.linenTxnQuerySchema)) q: Out<typeof O.linenTxnQuerySchema>): Promise<Paginated<O.LinenTxn>> {
    return this.linen.listTxns(q);
  }

  @Post('linen/txns')
  @RequirePermissions('ops.linen.manage')
  recordLinen(@Body(new ZodPipe(O.linenTxnInputSchema)) body: Out<typeof O.linenTxnInputSchema>): Promise<O.LinenTxn> {
    return this.linen.record(body);
  }

  // ---------- ambulance ----------

  @Get('ambulance/vehicles')
  @RequirePermissions('ops.ambulance.read')
  vehicles(): Promise<O.Vehicle[]> {
    return this.ambulance.listVehicles();
  }

  @Post('ambulance/vehicles')
  @RequirePermissions('ops.ambulance.manage')
  createVehicle(@Body(new ZodPipe(O.vehicleInputSchema)) body: Out<typeof O.vehicleInputSchema>): Promise<O.Vehicle> {
    return this.ambulance.createVehicle(body);
  }

  @Patch('ambulance/vehicles/:id')
  @RequirePermissions('ops.ambulance.manage')
  updateVehicle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(O.updateVehicleSchema)) body: Out<typeof O.updateVehicleSchema>,
  ): Promise<O.Vehicle> {
    return this.ambulance.updateVehicle(id, body);
  }

  @Get('ambulance/trips')
  @RequirePermissions('ops.ambulance.read')
  trips(@Query(new ZodPipe(O.tripQuerySchema)) q: Out<typeof O.tripQuerySchema>): Promise<Paginated<O.Trip>> {
    return this.ambulance.listTrips(q);
  }

  @Get('ambulance/trips/:id')
  @RequirePermissions('ops.ambulance.read')
  trip(@Param('id', ParseUUIDPipe) id: string): Promise<O.Trip> {
    return this.ambulance.getTrip(id);
  }

  @Post('ambulance/trips')
  @RequirePermissions('ops.ambulance.manage')
  createTrip(@Body(new ZodPipe(O.createTripSchema)) body: Out<typeof O.createTripSchema>): Promise<O.Trip> {
    return this.ambulance.createTrip(body);
  }

  @Post('ambulance/trips/:id/actions')
  @HttpCode(200)
  @RequirePermissions('ops.ambulance.manage')
  tripAction(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(O.tripActionSchema)) body: Out<typeof O.tripActionSchema>): Promise<O.Trip> {
    return this.ambulance.act(id, body);
  }

  // ---------- diet ----------

  @Get('diet/orders')
  @RequirePermissions('ops.diet.read')
  dietOrders(@Query(new ZodPipe(O.dietOrderQuerySchema)) q: Out<typeof O.dietOrderQuerySchema>): Promise<Paginated<O.DietOrder>> {
    return this.diet.list(q);
  }

  @Post('diet/orders')
  @RequirePermissions('ops.diet.order')
  orderDiet(@Body(new ZodPipe(O.dietOrderInputSchema)) body: Out<typeof O.dietOrderInputSchema>): Promise<O.DietOrder> {
    return this.diet.order(body);
  }

  @Post('diet/orders/:id/stop')
  @HttpCode(200)
  @RequirePermissions('ops.diet.order')
  stopDiet(@Param('id', ParseUUIDPipe) id: string): Promise<O.DietOrder> {
    return this.diet.stop(id);
  }

  @Get('diet/kitchen-sheet')
  @RequirePermissions('ops.diet.read')
  kitchenSheet(@Query(new ZodPipe(O.kitchenSheetQuerySchema)) q: Out<typeof O.kitchenSheetQuerySchema>): Promise<O.KitchenSheet> {
    return this.diet.kitchenSheet(q);
  }

  @Post('diet/meals')
  @HttpCode(200)
  @RequirePermissions('ops.diet.serve')
  markMeal(@Body(new ZodPipe(O.markMealSchema)) body: Out<typeof O.markMealSchema>): Promise<{ ok: true }> {
    return this.diet.markMeal(body);
  }

  // ---------- housekeeping ----------

  @Get('housekeeping/tasks')
  @RequirePermissions('ops.housekeeping.read')
  hkTasks(@Query(new ZodPipe(O.hkTaskQuerySchema)) q: Out<typeof O.hkTaskQuerySchema>): Promise<Paginated<O.HkTask>> {
    return this.hk.list(q);
  }

  @Post('housekeeping/tasks')
  @RequirePermissions('ops.housekeeping.request')
  createHkTask(@Body(new ZodPipe(O.createHkTaskSchema)) body: Out<typeof O.createHkTaskSchema>): Promise<O.HkTask> {
    return this.hk.create(body);
  }

  @Patch('housekeeping/tasks/:id')
  @RequirePermissions('ops.housekeeping.manage')
  updateHkTask(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(O.updateHkTaskSchema)) body: Out<typeof O.updateHkTaskSchema>): Promise<O.HkTask> {
    return this.hk.update(id, body);
  }
}
