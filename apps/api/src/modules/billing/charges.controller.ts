import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { billing as contracts, type Paginated } from '@hms/shared';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { RequireEntitlement } from '../platform';
import { ChargesService } from './charges.service';

const uuid = new ParseUUIDPipe();
const rulesQuery = z.object({ facilityId: z.uuid().optional() });

/** Patient account (pending charges), the billing desk and the hospital's billing rules. */
@Controller('billing')
@RequireEntitlement('billing')
export class ChargesController {
  constructor(private readonly charges: ChargesService) {}

  @Get('charges')
  @RequirePermissions('billing.invoice.read')
  list(@Query() query: unknown): Promise<Paginated<contracts.Charge>> {
    return this.charges.list(query);
  }

  @Post('charges')
  @RequirePermissions('billing.invoice.create')
  add(@Body(new ZodPipe(contracts.manualChargeSchema)) body: contracts.ManualChargeInput): Promise<contracts.Charge> {
    return this.charges.addManual(body);
  }

  /** Pending charges (plus desk lines) → one final bill, with advance and payment. */
  @Post('charges/bill')
  @RequirePermissions('billing.invoice.create')
  bill(@Body(new ZodPipe(contracts.billChargesSchema)) body: contracts.BillChargesInput): Promise<contracts.Invoice> {
    return this.charges.billFromApi(body);
  }

  @Post('charges/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('billing.invoice.create')
  cancel(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.cancelChargeSchema)) body: contracts.CancelChargeInput): Promise<contracts.Charge> {
    return this.charges.cancel(id, body);
  }

  /** Credit note (and refund if paid) for a billed charge whose order was cancelled. */
  @Post('charges/:id/credit')
  @HttpCode(200)
  @RequirePermissions('billing.creditnote.create')
  credit(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.creditChargeSchema)) body: contracts.CreditChargeInput): Promise<contracts.Invoice> {
    return this.charges.credit(id, body);
  }

  @Get('patients/:patientId/charges')
  @RequirePermissions('billing.invoice.read')
  patientCharges(@Param('patientId', uuid) patientId: string): Promise<contracts.PatientCharges> {
    return this.charges.patientCharges(patientId);
  }

  @Get('unbilled')
  @RequirePermissions('billing.invoice.read')
  unbilled(@Query() query: unknown): Promise<Paginated<contracts.UnbilledPatient>> {
    return this.charges.unbilled(query);
  }

  @Get('rules')
  @RequirePermissions('billing.service.read')
  rules(@Query(new ZodPipe(rulesQuery)) q: z.infer<typeof rulesQuery>): Promise<contracts.BillingRulesView> {
    return this.charges.getRules(q.facilityId);
  }

  @Put('rules')
  @RequirePermissions('billing.settings.manage')
  saveRules(@Body(new ZodPipe(contracts.billingRulesInputSchema)) body: contracts.BillingRulesInput): Promise<contracts.BillingRulesView> {
    return this.charges.saveRules(body);
  }
}
