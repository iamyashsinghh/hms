import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { integrations } from '@hms/shared';
import type { FastifyRequest } from 'fastify';
import { Ctx, Public } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/context/request-context';
import { notFound } from '../../common/errors/errors';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { ABDM_SIGNATURE_HEADER, AbdmService } from './abdm.service';
import { ApiKeyGuard, RequireApiScopes } from './api-key.guard';
import type { ApiKeyPrincipal } from './developer.service';
import { DevicesService } from './devices.service';
import { PaymentsService } from './payments.service';
import { bindTenant } from './tenant-scope';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Third-party API, authenticated with a hospital's API key (see ApiKeyGuard). */
@Public()
@UseGuards(ApiKeyGuard)
@Controller('integrations/public/v1')
export class IntegrationsPublicController {
  constructor(
    private readonly abdm: AbdmService,
    private readonly devices: DevicesService,
    private readonly payments: PaymentsService,
  ) {}

  @Get('ping')
  ping(@Req() req: FastifyRequest & { apiKey: ApiKeyPrincipal }) {
    return { ok: true, key: req.apiKey.name, scopes: req.apiKey.scopes };
  }

  @Get('fhir/Patient/:id')
  @RequireApiScopes('patients.read')
  patient(@Param('id', ParseUUIDPipe) id: string): Promise<integrations.FhirResource> {
    return this.abdm.fhirPatient(id);
  }

  @Post('lab/hl7')
  @HttpCode(200)
  @RequireApiScopes('lab.results.write')
  hl7(@Body(new ZodPipe(integrations.hl7InboundSchema)) body: integrations.Hl7Inbound): Promise<integrations.Hl7AckResponse> {
    return this.devices.receive({ code: body.deviceCode }, body.message);
  }

  @Get('payments/:id')
  @RequireApiScopes('payments.read')
  payment(@Param('id', ParseUUIDPipe) id: string): Promise<integrations.PaymentIntent> {
    return this.payments.get(id);
  }
}

/**
 * Callbacks from ABDM and payment gateways. The hospital is part of the URL we register with them;
 * each request is authenticated by its signature, not by a login.
 */
@Public()
@Controller('integrations/callbacks')
export class IntegrationsCallbacksController {
  constructor(
    private readonly abdm: AbdmService,
    private readonly payments: PaymentsService,
  ) {}

  @Post('abdm/:tenantId/profile-share')
  @HttpCode(202)
  profileShare(@Ctx() ctx: RequestContext, @Param('tenantId') tenantId: string, @Body() body: unknown, @Headers(ABDM_SIGNATURE_HEADER) signature?: string) {
    if (!UUID.test(tenantId)) throw notFound('Facility');
    bindTenant(ctx, tenantId);
    return this.abdm.profileShareCallback(body, signature);
  }

  @Post('payments/:provider/:tenantId')
  @HttpCode(200)
  paymentWebhook(@Ctx() ctx: RequestContext, @Param('provider') provider: string, @Param('tenantId') tenantId: string, @Body() body: unknown, @Req() req: FastifyRequest) {
    if (!UUID.test(tenantId)) throw notFound('Facility');
    bindTenant(ctx, tenantId);
    return this.payments.handleWebhook(provider, body, req.headers);
  }
}
