import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { radiology, type Paginated } from '@hms/shared';
import type { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { RequireEntitlement } from '../platform';
import { RadiologyService } from './radiology.service';

type Out<T extends z.ZodType> = z.output<T>;
type OrderWithReports = radiology.OrderWithReports;
type RadiologyOrder = radiology.RadiologyOrder;

/** Every radiology route needs a plan that includes radiology (Growth and up). */
@Controller('radiology')
@RequireEntitlement('radiology')
export class RadiologyController {
  constructor(private readonly svc: RadiologyService) {}

  // ---------- masters ----------

  @Get('modalities')
  @RequirePermissions('radiology.master.read')
  modalities(@Query(new ZodPipe(radiology.masterQuerySchema)) q: Out<typeof radiology.masterQuerySchema>): Promise<radiology.Modality[]> {
    return this.svc.listModalities(q.includeInactive);
  }

  @Post('modalities')
  @RequirePermissions('radiology.master.manage')
  createModality(@Body(new ZodPipe(radiology.modalityInputSchema)) body: radiology.ModalityInput): Promise<radiology.Modality> {
    return this.svc.createModality(body);
  }

  @Patch('modalities/:id')
  @RequirePermissions('radiology.master.manage')
  updateModality(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(radiology.updateModalitySchema)) body: radiology.UpdateModality,
  ): Promise<radiology.Modality> {
    return this.svc.updateModality(id, body);
  }

  @Get('tests')
  @RequirePermissions('radiology.master.read')
  tests(@Query(new ZodPipe(radiology.masterQuerySchema)) q: Out<typeof radiology.masterQuerySchema>): Promise<radiology.RadiologyTest[]> {
    return this.svc.listTests(q);
  }

  @Get('tests/:id')
  @RequirePermissions('radiology.master.read')
  test(@Param('id', ParseUUIDPipe) id: string): Promise<radiology.RadiologyTest> {
    return this.svc.getTest(id);
  }

  @Post('tests')
  @RequirePermissions('radiology.master.manage')
  createTest(@Body(new ZodPipe(radiology.testInputSchema)) body: radiology.TestInput): Promise<radiology.RadiologyTest> {
    return this.svc.createTest(body);
  }

  @Patch('tests/:id')
  @RequirePermissions('radiology.master.manage')
  updateTest(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(radiology.updateTestSchema)) body: radiology.UpdateTest): Promise<radiology.RadiologyTest> {
    return this.svc.updateTest(id, body);
  }

  @Get('templates')
  @RequirePermissions('radiology.master.read')
  templates(@Query(new ZodPipe(radiology.masterQuerySchema)) q: Out<typeof radiology.masterQuerySchema>): Promise<radiology.ReportTemplate[]> {
    return this.svc.listTemplates(q);
  }

  @Get('templates/:id')
  @RequirePermissions('radiology.master.read')
  template(@Param('id', ParseUUIDPipe) id: string): Promise<radiology.ReportTemplate> {
    return this.svc.getTemplate(id);
  }

  @Post('templates')
  @RequirePermissions('radiology.master.manage')
  createTemplate(@Body(new ZodPipe(radiology.templateInputSchema)) body: radiology.TemplateInput): Promise<radiology.ReportTemplate> {
    return this.svc.createTemplate(body);
  }

  @Patch('templates/:id')
  @RequirePermissions('radiology.master.manage')
  updateTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(radiology.updateTemplateSchema)) body: radiology.UpdateTemplate,
  ): Promise<radiology.ReportTemplate> {
    return this.svc.updateTemplate(id, body);
  }

  @Post('masters/starter')
  @HttpCode(200)
  @RequirePermissions('radiology.master.manage')
  starter(): Promise<{ modalities: number; tests: number; templates: number }> {
    return this.svc.loadStarterMasters();
  }

  // ---------- orders, worklist, schedule ----------

  @Get('orders')
  @RequirePermissions('radiology.order.read')
  orders(@Query(new ZodPipe(radiology.orderQuerySchema)) q: Out<typeof radiology.orderQuerySchema>): Promise<Paginated<RadiologyOrder>> {
    return this.svc.listOrders(q);
  }

  @Get('orders/:id')
  @RequirePermissions('radiology.order.read')
  order(@Param('id', ParseUUIDPipe) id: string): Promise<OrderWithReports> {
    return this.svc.getOrder(id);
  }

  @Post('orders')
  @RequirePermissions('radiology.order.create')
  createOrder(@Body(new ZodPipe(radiology.createOrderSchema)) body: radiology.CreateOrder): Promise<RadiologyOrder> {
    return this.svc.createOrder(body);
  }

  @Patch('orders/:id')
  @RequirePermissions('radiology.order.create')
  updateOrder(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(radiology.updateOrderSchema)) body: radiology.UpdateOrder): Promise<RadiologyOrder> {
    return this.svc.updateOrder(id, body);
  }

  @Post('orders/:id/schedule')
  @HttpCode(200)
  @RequirePermissions('radiology.order.schedule')
  schedule(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(radiology.scheduleOrderSchema)) body: radiology.ScheduleOrder): Promise<RadiologyOrder> {
    return this.svc.schedule(id, body);
  }

  @Post('orders/:id/start')
  @HttpCode(200)
  @RequirePermissions('radiology.order.schedule')
  start(@Param('id', ParseUUIDPipe) id: string): Promise<RadiologyOrder> {
    return this.svc.start(id);
  }

  @Post('orders/:id/complete')
  @HttpCode(200)
  @RequirePermissions('radiology.order.schedule')
  complete(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(radiology.completeScanSchema)) body: radiology.CompleteScan): Promise<RadiologyOrder> {
    return this.svc.completeScan(id, body);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('radiology.order.cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(radiology.cancelOrderSchema)) body: radiology.CancelOrder): Promise<RadiologyOrder> {
    return this.svc.cancel(id, body);
  }

  @Post('orders/:id/bill')
  @HttpCode(200)
  @RequirePermissions('radiology.order.bill')
  bill(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(radiology.billOrderSchema)) body: radiology.BillOrder): Promise<RadiologyOrder> {
    return this.svc.bill(id, body);
  }

  @Get('schedule')
  @RequirePermissions('radiology.order.read')
  scheduleFor(@Query(new ZodPipe(radiology.scheduleQuerySchema)) q: Out<typeof radiology.scheduleQuerySchema>): Promise<radiology.ScheduleEntry[]> {
    return this.svc.scheduleFor(q);
  }

  // ---------- reports ----------

  @Put('orders/:id/report')
  @RequirePermissions('radiology.report.write')
  saveReport(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(radiology.saveReportSchema)) body: radiology.SaveReport): Promise<OrderWithReports> {
    return this.svc.saveReport(id, body);
  }

  @Delete('orders/:id/report/draft')
  @RequirePermissions('radiology.report.write')
  discardDraft(@Param('id', ParseUUIDPipe) id: string): Promise<OrderWithReports> {
    return this.svc.discardDraft(id);
  }

  @Post('orders/:id/report/finalize')
  @HttpCode(200)
  @RequirePermissions('radiology.report.finalize')
  finalize(@Param('id', ParseUUIDPipe) id: string): Promise<OrderWithReports> {
    return this.svc.finalizeReport(id);
  }

  @Post('orders/:id/report/amend')
  @HttpCode(200)
  @RequirePermissions('radiology.report.finalize')
  amend(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(radiology.amendReportSchema)) body: radiology.AmendReport): Promise<OrderWithReports> {
    return this.svc.amendReport(id, body);
  }

  @Get('reports/:id')
  @RequirePermissions('radiology.report.read')
  report(@Param('id', ParseUUIDPipe) id: string): Promise<radiology.ReportDocument> {
    return this.svc.getReport(id);
  }
}
