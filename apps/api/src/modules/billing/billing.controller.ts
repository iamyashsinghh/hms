import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { billing as contracts, importRequestSchema, type ImportResult, type Paginated } from '@hms/shared';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { RequireEntitlement } from '../platform';
import { BillingService } from './billing.service';

const uuid = new ParseUUIDPipe();
const priceQuery = z.object({ code: z.string().trim().min(1).max(40), payerId: z.uuid().optional() });
const shiftQuery = z.object({
  userId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

@Controller('billing')
@RequireEntitlement('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  // ---------- settings ----------

  @Get('settings')
  @RequirePermissions('billing.service.read')
  getSettings(): Promise<contracts.BillingSettings> {
    return this.billing.getSettings();
  }

  @Put('settings')
  @RequirePermissions('billing.settings.manage')
  updateSettings(@Body(new ZodPipe(contracts.billingSettingsInputSchema)) body: contracts.BillingSettingsInput): Promise<contracts.BillingSettings> {
    return this.billing.updateSettings(body);
  }

  // ---------- services ----------

  @Get('services')
  @RequirePermissions('billing.service.read')
  listServices(@Query() query: unknown): Promise<Paginated<contracts.Service>> {
    return this.billing.listServices(query);
  }

  @Get('services/price')
  @RequirePermissions('billing.service.read')
  price(@Query(new ZodPipe(priceQuery)) q: z.infer<typeof priceQuery>): Promise<contracts.ServicePrice> {
    return this.billing.getServicePrice(q.code, q.payerId);
  }

  @Get('services/:id')
  @RequirePermissions('billing.service.read')
  getService(@Param('id', uuid) id: string): Promise<contracts.Service> {
    return this.billing.getService(id);
  }

  @Post('services')
  @RequirePermissions('billing.service.manage')
  createService(@Body(new ZodPipe(contracts.createServiceSchema)) body: contracts.CreateService): Promise<contracts.Service> {
    return this.billing.createService(body);
  }

  /** Bulk import from Excel / CSV. `dryRun` validates only (the preview). */
  @Post('services/import')
  @HttpCode(200)
  @RequirePermissions('billing.service.manage')
  importServices(@Body(new ZodPipe(importRequestSchema)) body: z.output<typeof importRequestSchema>): Promise<ImportResult> {
    return this.billing.importServices(body);
  }

  @Patch('services/:id')
  @RequirePermissions('billing.service.manage')
  updateService(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.updateServiceSchema)) body: contracts.UpdateService): Promise<contracts.Service> {
    return this.billing.updateService(id, body);
  }

  // ---------- price lists ----------

  @Get('price-lists')
  @RequirePermissions('billing.service.read')
  listPriceLists(): Promise<contracts.PriceList[]> {
    return this.billing.listPriceLists();
  }

  @Get('price-lists/:id')
  @RequirePermissions('billing.service.read')
  getPriceList(@Param('id', uuid) id: string): Promise<contracts.PriceList> {
    return this.billing.getPriceList(id);
  }

  @Post('price-lists')
  @RequirePermissions('billing.service.manage')
  createPriceList(@Body(new ZodPipe(contracts.priceListInputSchema)) body: contracts.PriceListInput): Promise<contracts.PriceList> {
    return this.billing.savePriceList(null, body);
  }

  @Put('price-lists/:id')
  @RequirePermissions('billing.service.manage')
  updatePriceList(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.priceListInputSchema)) body: contracts.PriceListInput): Promise<contracts.PriceList> {
    return this.billing.savePriceList(id, body);
  }

  // ---------- invoices ----------

  @Get('invoices')
  @RequirePermissions('billing.invoice.read')
  listInvoices(@Query() query: unknown): Promise<Paginated<contracts.InvoiceSummary>> {
    return this.billing.listInvoices(query);
  }

  @Get('invoices/:id')
  @RequirePermissions('billing.invoice.read')
  getInvoice(@Param('id', uuid) id: string): Promise<contracts.Invoice> {
    return this.billing.getInvoice(id);
  }

  @Post('invoices')
  @RequirePermissions('billing.invoice.create')
  createInvoice(@Body(new ZodPipe(contracts.createInvoiceSchema)) body: contracts.CreateInvoice): Promise<contracts.Invoice> {
    return this.billing.createInvoiceFromApi(body);
  }

  @Patch('invoices/:id')
  @RequirePermissions('billing.invoice.create')
  updateInvoice(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.updateInvoiceSchema)) body: contracts.UpdateInvoice): Promise<contracts.Invoice> {
    return this.billing.updateDraft(id, body);
  }

  @Delete('invoices/:id')
  @HttpCode(204)
  @RequirePermissions('billing.invoice.create')
  deleteInvoice(@Param('id', uuid) id: string): Promise<void> {
    return this.billing.deleteDraft(id);
  }

  @Post('invoices/:id/finalize')
  @HttpCode(200)
  @RequirePermissions('billing.invoice.finalize')
  finalize(@Param('id', uuid) id: string): Promise<contracts.Invoice> {
    return this.billing.finalize(id);
  }

  @Post('invoices/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('billing.invoice.cancel')
  cancel(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.cancelInvoiceSchema)) body: contracts.CancelInvoice): Promise<contracts.Invoice> {
    return this.billing.cancel(id, body.reason);
  }

  @Post('invoices/:id/payments')
  @RequirePermissions('billing.payment.collect')
  collect(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.collectPaymentSchema)) body: contracts.CollectPayment): Promise<contracts.Invoice> {
    return this.billing.collectPayment(id, body);
  }

  @Post('invoices/:id/credit-notes')
  @RequirePermissions('billing.creditnote.create')
  creditNote(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.creditNoteSchema)) body: contracts.CreditNoteInput): Promise<contracts.Invoice> {
    return this.billing.createCreditNote(id, body);
  }

  // ---------- receipts, deposits, refunds ----------

  @Get('payments')
  @RequirePermissions('billing.invoice.read')
  listPayments(@Query() query: unknown): Promise<Paginated<contracts.Payment>> {
    return this.billing.listPayments(query);
  }

  @Get('payments/:id')
  @RequirePermissions('billing.invoice.read')
  getPayment(@Param('id', uuid) id: string): Promise<contracts.Payment> {
    return this.billing.getPayment(id);
  }

  @Post('deposits')
  @RequirePermissions('billing.payment.collect')
  deposit(@Body(new ZodPipe(contracts.depositSchema)) body: contracts.DepositInput): Promise<contracts.Payment> {
    return this.billing.collectDeposit(body);
  }

  @Post('refunds')
  @RequirePermissions('billing.payment.refund')
  refund(@Body(new ZodPipe(contracts.refundSchema)) body: contracts.RefundInput): Promise<contracts.Payment> {
    return this.billing.refund(body);
  }

  @Get('patients/:patientId/account')
  @RequirePermissions('billing.invoice.read')
  account(@Param('patientId', uuid) patientId: string): Promise<contracts.PatientAccount> {
    return this.billing.patientAccount(patientId);
  }

  // ---------- cash shifts ----------

  @Get('shifts/current')
  @RequirePermissions('billing.shift.manage')
  currentShift(): Promise<{ shift: contracts.CashShift | null }> {
    return this.billing.currentShift().then((shift) => ({ shift }));
  }

  @Post('shifts/open')
  @RequirePermissions('billing.shift.manage')
  openShift(@Body(new ZodPipe(contracts.openShiftSchema)) body: contracts.OpenShift): Promise<contracts.CashShift> {
    return this.billing.openShift(body);
  }

  @Post('shifts/close')
  @HttpCode(200)
  @RequirePermissions('billing.shift.manage')
  closeShift(@Body(new ZodPipe(contracts.closeShiftSchema)) body: contracts.CloseShift): Promise<contracts.CashShift> {
    return this.billing.closeShift(body);
  }

  @Get('shifts')
  @RequirePermissions('billing.shift.read')
  listShifts(@Query(new ZodPipe(shiftQuery)) q: z.infer<typeof shiftQuery>): Promise<Paginated<contracts.CashShift>> {
    return this.billing.listShifts(q);
  }

  @Get('shifts/:id')
  @RequirePermissions('billing.shift.read')
  getShift(@Param('id', uuid) id: string): Promise<contracts.CashShift> {
    return this.billing.getShift(id);
  }
}
