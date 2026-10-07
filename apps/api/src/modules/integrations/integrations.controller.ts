import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { integrations, type Paginated } from '@hms/shared';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { RequireEntitlement } from '../platform';
import { AbdmService } from './abdm.service';
import { DeveloperService } from './developer.service';
import { DevicesService } from './devices.service';
import { PaymentsService } from './payments.service';
import { IntegrationSettingsService } from './settings.service';

const I = integrations;

/** Staff routes. Third-party routes are in public.controller.ts. */
@RequireEntitlement('integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly settings: IntegrationSettingsService,
    private readonly abdm: AbdmService,
    private readonly payments: PaymentsService,
    private readonly developer: DeveloperService,
    private readonly devices: DevicesService,
  ) {}

  // ---------- settings ----------

  /** Every staff member can see which integrations are on (screens adapt to it). */
  @Get('settings')
  @RequirePermissions('core.facility.read')
  getSettings(): Promise<integrations.IntegrationSettings> {
    return this.settings.get();
  }

  @Put('settings')
  @RequirePermissions('integrations.settings.manage')
  updateSettings(@Body(new ZodPipe(I.settingsInputSchema)) body: integrations.SettingsInput): Promise<integrations.IntegrationSettings> {
    return this.settings.update(body);
  }

  // ---------- ABHA ----------

  @Post('abha/otp')
  @RequirePermissions('integrations.abha.manage')
  requestOtp(@Body() body: integrations.AbhaOtpRequest): Promise<integrations.AbhaRequest> {
    return this.abdm.requestOtp(body);
  }

  @Post('abha/otp/verify')
  @HttpCode(200)
  @RequirePermissions('integrations.abha.manage')
  verifyOtp(@Body(new ZodPipe(I.abhaOtpVerifySchema)) body: integrations.AbhaOtpVerify): Promise<integrations.AbhaRequest> {
    return this.abdm.verifyOtp(body);
  }

  @Get('abha/links')
  @RequirePermissions('integrations.abha.read')
  links(@Query() q: unknown): Promise<Paginated<integrations.AbhaLink>> {
    return this.abdm.links(q);
  }

  @Post('abha/links')
  @RequirePermissions('integrations.abha.manage', 'core.patient.update')
  link(@Body(new ZodPipe(I.abhaLinkSchema)) body: integrations.AbhaLinkInput): Promise<integrations.AbhaLink> {
    return this.abdm.link(body);
  }

  @Post('abha/links/:id/unlink')
  @HttpCode(200)
  @RequirePermissions('integrations.abha.manage')
  unlink(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(I.abhaUnlinkSchema)) body: integrations.AbhaUnlinkInput): Promise<integrations.AbhaLink> {
    return this.abdm.unlink(id, body);
  }

  // ---------- Scan and Share ----------

  @Get('abdm/scan-share')
  @RequirePermissions('integrations.abha.read')
  scanShares(@Query() q: unknown): Promise<integrations.ScanShareToken[]> {
    return this.abdm.scanShares(q);
  }

  @Post('abdm/scan-share/simulate')
  @RequirePermissions('integrations.abha.manage')
  simulateScan(@Body(new ZodPipe(I.scanShareSimulateSchema)) body: integrations.ScanShareSimulate): Promise<integrations.ScanShareToken> {
    return this.abdm.simulateScan(body);
  }

  @Post('abdm/scan-share/:id/resolve')
  @HttpCode(200)
  @RequirePermissions('integrations.abha.manage', 'core.patient.create', 'core.patient.update')
  resolveScanShare(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(I.scanShareResolveSchema)) body: integrations.ScanShareResolve): Promise<integrations.ScanShareToken> {
    return this.abdm.resolveScanShare(id, body);
  }

  // ---------- care contexts ----------

  @Get('abdm/care-contexts')
  @RequirePermissions('integrations.abha.read')
  careContexts(@Query() q: unknown): Promise<Paginated<integrations.CareContext>> {
    return this.abdm.careContexts(q);
  }

  @Post('abdm/care-contexts/:id/retry')
  @HttpCode(200)
  @RequirePermissions('integrations.abha.manage')
  retryCareContext(@Param('id', ParseUUIDPipe) id: string): Promise<integrations.CareContext> {
    return this.abdm.retryCareContext(id);
  }

  // ---------- consents ----------

  @Get('abdm/consents')
  @RequirePermissions('integrations.consent.read')
  consents(@Query() q: unknown): Promise<Paginated<integrations.ConsentRequest>> {
    return this.abdm.consents(q);
  }

  @Post('abdm/consents')
  @RequirePermissions('integrations.consent.manage')
  requestConsent(@Body(new ZodPipe(I.consentRequestSchema)) body: integrations.ConsentRequestInput): Promise<integrations.ConsentRequest> {
    return this.abdm.requestConsent(body);
  }

  @Get('abdm/consents/:id')
  @RequirePermissions('integrations.consent.read')
  consent(@Param('id', ParseUUIDPipe) id: string): Promise<integrations.ConsentRequest> {
    return this.abdm.getConsent(id);
  }

  @Post('abdm/consents/:id/refresh')
  @HttpCode(200)
  @RequirePermissions('integrations.consent.read')
  refreshConsent(@Param('id', ParseUUIDPipe) id: string): Promise<integrations.ConsentRequest> {
    return this.abdm.refreshConsent(id);
  }

  @Get('abdm/consents/:id/records')
  @RequirePermissions('integrations.consent.read')
  consentRecords(@Param('id', ParseUUIDPipe) id: string): Promise<integrations.FhirBundle[]> {
    return this.abdm.consentRecords(id);
  }

  @Get('fhir/Patient/:id')
  @RequirePermissions('core.patient.read')
  fhirPatient(@Param('id', ParseUUIDPipe) id: string): Promise<integrations.FhirResource> {
    return this.abdm.fhirPatient(id);
  }

  // ---------- payments ----------

  @Get('payments')
  @RequirePermissions('integrations.payment.read')
  listPayments(@Query() q: unknown): Promise<Paginated<integrations.PaymentIntent>> {
    return this.payments.list(q);
  }

  @Post('payments')
  @RequirePermissions('integrations.payment.create', 'billing.invoice.read')
  createPayment(@Body(new ZodPipe(I.createPaymentIntentSchema)) body: integrations.CreatePaymentIntent): Promise<integrations.PaymentIntent> {
    return this.payments.create(body);
  }

  @Get('payments/:id')
  @RequirePermissions('integrations.payment.read')
  getPayment(@Param('id', ParseUUIDPipe) id: string): Promise<integrations.PaymentIntent> {
    return this.payments.get(id);
  }

  @Post('payments/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('integrations.payment.create')
  cancelPayment(@Param('id', ParseUUIDPipe) id: string): Promise<integrations.PaymentIntent> {
    return this.payments.cancel(id);
  }

  @Post('payments/:id/mock-complete')
  @HttpCode(200)
  @RequirePermissions('integrations.payment.create')
  mockComplete(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(I.mockPaymentOutcomeSchema)) body: integrations.MockPaymentOutcome): Promise<integrations.PaymentIntent> {
    return this.payments.mockComplete(id, body);
  }

  // ---------- API keys ----------

  @Get('api-keys')
  @RequirePermissions('integrations.developer.manage')
  apiKeys(): Promise<integrations.ApiKey[]> {
    return this.developer.listKeys();
  }

  @Post('api-keys')
  @RequirePermissions('integrations.developer.manage')
  createApiKey(@Body(new ZodPipe(I.createApiKeySchema)) body: integrations.CreateApiKey): Promise<integrations.CreatedApiKey> {
    return this.developer.createKey(body);
  }

  @Post('api-keys/:id/revoke')
  @HttpCode(200)
  @RequirePermissions('integrations.developer.manage')
  revokeApiKey(@Param('id', ParseUUIDPipe) id: string): Promise<integrations.ApiKey> {
    return this.developer.revokeKey(id);
  }

  // ---------- webhooks ----------

  @Get('webhooks')
  @RequirePermissions('integrations.developer.manage')
  webhooks(): Promise<integrations.WebhookEndpoint[]> {
    return this.developer.listEndpoints();
  }

  @Post('webhooks')
  @RequirePermissions('integrations.developer.manage')
  createWebhook(@Body(new ZodPipe(I.webhookEndpointInputSchema)) body: integrations.WebhookEndpointInput): Promise<integrations.WebhookEndpoint> {
    return this.developer.createEndpoint(body);
  }

  @Get('webhooks/deliveries')
  @RequirePermissions('integrations.developer.manage')
  deliveries(@Query() q: unknown): Promise<Paginated<integrations.WebhookDelivery>> {
    return this.developer.deliveries(q);
  }

  @Post('webhooks/deliveries/:id/retry')
  @HttpCode(200)
  @RequirePermissions('integrations.developer.manage')
  retryDelivery(@Param('id', ParseUUIDPipe) id: string): Promise<integrations.WebhookDelivery> {
    return this.developer.retry(id);
  }

  @Put('webhooks/:id')
  @RequirePermissions('integrations.developer.manage')
  updateWebhook(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(I.webhookEndpointInputSchema)) body: integrations.WebhookEndpointInput): Promise<integrations.WebhookEndpoint> {
    return this.developer.updateEndpoint(id, body);
  }

  @Post('webhooks/:id/rotate-secret')
  @HttpCode(200)
  @RequirePermissions('integrations.developer.manage')
  rotateSecret(@Param('id', ParseUUIDPipe) id: string): Promise<integrations.WebhookEndpoint> {
    return this.developer.rotateSecret(id);
  }

  @Post('webhooks/:id/test')
  @HttpCode(200)
  @RequirePermissions('integrations.developer.manage')
  testWebhook(@Param('id', ParseUUIDPipe) id: string): Promise<integrations.WebhookDelivery> {
    return this.developer.sendTest(id);
  }

  // ---------- lab machines ----------

  @Get('devices')
  @RequirePermissions('integrations.device.read')
  listDevices(): Promise<integrations.LabDevice[]> {
    return this.devices.list();
  }

  @Post('devices')
  @RequirePermissions('integrations.device.manage')
  createDevice(@Body(new ZodPipe(I.deviceInputSchema)) body: integrations.DeviceInput): Promise<integrations.LabDevice> {
    return this.devices.create(body);
  }

  @Get('devices/messages')
  @RequirePermissions('integrations.device.read')
  deviceMessages(@Query() q: unknown): Promise<Paginated<integrations.DeviceMessage>> {
    return this.devices.messages(q);
  }

  @Get('devices/messages/:id')
  @RequirePermissions('integrations.device.read')
  deviceMessage(@Param('id', ParseUUIDPipe) id: string): Promise<integrations.DeviceMessage> {
    return this.devices.message(id);
  }

  @Patch('devices/:id')
  @RequirePermissions('integrations.device.manage')
  updateDevice(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(I.updateDeviceSchema)) body: integrations.UpdateDevice): Promise<integrations.LabDevice> {
    return this.devices.update(id, body);
  }

  @Post('devices/:id/test-message')
  @HttpCode(200)
  @RequirePermissions('integrations.device.manage')
  testMessage(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(I.deviceTestMessageSchema)) body: integrations.DeviceTestMessage): Promise<integrations.Hl7AckResponse> {
    return this.devices.receive({ id }, body.message);
  }
}
