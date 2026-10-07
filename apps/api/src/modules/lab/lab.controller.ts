import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { lab, type Paginated } from '@hms/shared';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { RequireEntitlement } from '../platform';
import { LabService } from './lab.service';

type Order = lab.Order;
const billSchema = z.object({ payNow: lab.createOrderSchema.shape.payNow });

@Controller('lab')
@RequireEntitlement('lab')
export class LabController {
  constructor(private readonly lab: LabService) {}

  // ---------- catalogue ----------

  @Get('tests')
  @RequirePermissions('lab.test.read')
  listTests(@Query() q: unknown): Promise<lab.LabTest[]> {
    return this.lab.listTests(q);
  }

  @Get('tests/:id')
  @RequirePermissions('lab.test.read')
  getTest(@Param('id', ParseUUIDPipe) id: string): Promise<lab.LabTest> {
    return this.lab.getTest(id);
  }

  @Post('tests')
  @RequirePermissions('lab.test.manage')
  createTest(@Body(new ZodPipe(lab.testInputSchema)) body: lab.TestInput): Promise<lab.LabTest> {
    return this.lab.createTest(body);
  }

  @Patch('tests/:id')
  @RequirePermissions('lab.test.manage')
  updateTest(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(lab.updateTestSchema)) body: lab.UpdateTest): Promise<lab.LabTest> {
    return this.lab.updateTest(id, body);
  }

  @Get('panels')
  @RequirePermissions('lab.test.read')
  listPanels(@Query() q: unknown): Promise<lab.LabPanel[]> {
    return this.lab.listPanels(q);
  }

  @Get('panels/:id')
  @RequirePermissions('lab.test.read')
  getPanel(@Param('id', ParseUUIDPipe) id: string): Promise<lab.LabPanel> {
    return this.lab.getPanel(id);
  }

  @Post('panels')
  @RequirePermissions('lab.test.manage')
  createPanel(@Body(new ZodPipe(lab.panelInputSchema)) body: lab.PanelInput): Promise<lab.LabPanel> {
    return this.lab.createPanel(body);
  }

  @Patch('panels/:id')
  @RequirePermissions('lab.test.manage')
  updatePanel(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(lab.updatePanelSchema)) body: lab.UpdatePanel): Promise<lab.LabPanel> {
    return this.lab.updatePanel(id, body);
  }

  @Get('orderables')
  @RequirePermissions('lab.test.read')
  orderables(@Query() q: unknown): Promise<lab.Orderable[]> {
    return this.lab.orderables(q);
  }

  @Post('catalogue/starter')
  @HttpCode(200)
  @RequirePermissions('lab.test.manage')
  loadStarter(): Promise<{ testsAdded: number; panelsAdded: number }> {
    return this.lab.loadStarterCatalogue();
  }

  // ---------- orders ----------

  @Get('orders')
  @RequirePermissions('lab.order.read')
  listOrders(@Query() q: unknown): Promise<Paginated<lab.OrderSummary>> {
    return this.lab.listOrders(q);
  }

  @Post('orders')
  @RequirePermissions('lab.order.create')
  createOrder(@Body(new ZodPipe(lab.createOrderSchema)) body: lab.CreateOrder): Promise<Order> {
    return this.lab.createOrder(body);
  }

  @Get('orders/:id')
  @RequirePermissions('lab.order.read')
  getOrder(@Param('id', ParseUUIDPipe) id: string): Promise<Order> {
    return this.lab.getOrder(id);
  }

  @Get('orders/:id/report')
  @RequirePermissions('lab.order.read')
  report(@Param('id', ParseUUIDPipe) id: string): Promise<lab.Report> {
    return this.lab.report(id);
  }

  @Post('orders/:id/bill')
  @HttpCode(200)
  @RequirePermissions('lab.order.create')
  bill(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(billSchema)) body: z.output<typeof billSchema>): Promise<Order> {
    return this.lab.bill(id, body.payNow);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('lab.order.cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(lab.cancelOrderSchema)) body: lab.CancelOrder): Promise<Order> {
    return this.lab.cancel(id, body);
  }

  @Post('orders/:id/collect')
  @HttpCode(200)
  @RequirePermissions('lab.sample.collect')
  collectAll(@Param('id', ParseUUIDPipe) id: string): Promise<Order> {
    return this.lab.collectAll(id);
  }

  @Put('orders/:id/results')
  @RequirePermissions('lab.result.enter')
  enterResults(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(lab.enterResultsSchema)) body: lab.EnterResults): Promise<Order> {
    return this.lab.enterResults(id, body);
  }

  @Post('orders/:id/verify')
  @HttpCode(200)
  @RequirePermissions('lab.result.verify')
  verify(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(lab.verifySchema)) body: lab.Verify): Promise<Order> {
    return this.lab.verify(id, body);
  }

  @Post('orders/:id/amend')
  @HttpCode(200)
  @RequirePermissions('lab.result.verify')
  amend(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(lab.amendSchema)) body: lab.Amend): Promise<Order> {
    return this.lab.amend(id, body);
  }

  // ---------- samples ----------

  @Get('samples')
  @RequirePermissions('lab.order.read')
  worklist(@Query() q: unknown): Promise<lab.WorklistSample[]> {
    return this.lab.worklist(q);
  }

  @Post('samples/:id/collect')
  @HttpCode(200)
  @RequirePermissions('lab.sample.collect')
  collect(@Param('id', ParseUUIDPipe) id: string): Promise<Order> {
    return this.lab.collect(id);
  }

  @Post('samples/:id/receive')
  @HttpCode(200)
  @RequirePermissions('lab.sample.collect')
  receive(@Param('id', ParseUUIDPipe) id: string): Promise<Order> {
    return this.lab.receive(id);
  }

  @Post('samples/:id/reject')
  @HttpCode(200)
  @RequirePermissions('lab.sample.collect')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(lab.rejectSampleSchema)) body: lab.RejectSample): Promise<Order> {
    return this.lab.reject(id, body);
  }

  @Post('samples/:id/recollect')
  @HttpCode(200)
  @RequirePermissions('lab.sample.collect')
  recollect(@Param('id', ParseUUIDPipe) id: string): Promise<Order> {
    return this.lab.recollect(id);
  }
}
