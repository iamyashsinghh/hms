import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { PatientsModule } from '../patients/patients.module';
import { AbdmService } from './abdm.service';
import { DryRunWebhookTransport, HttpWebhookTransport, WEBHOOK_TRANSPORT } from './adapters/webhook.transport';
import { ApiKeyGuard } from './api-key.guard';
import { DeveloperService } from './developer.service';
import { DevicesService } from './devices.service';
import { INTEGRATIONS_CONFIG, loadIntegrationsConfig, type IntegrationsConfig } from './integrations.config';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsRepository } from './integrations.repository';
import { PaymentsService } from './payments.service';
import { IntegrationsCallbacksController, IntegrationsPublicController } from './public.controller';
import { IntegrationSettingsService } from './settings.service';

/**
 * Integrations (ABDM, payment gateways, public API keys, webhooks, lab machines). Owned by the
 * "integrations" workstream (see PARALLEL_PLAN.md). External systems sit behind adapters in ./adapters;
 * the shipped ones are mock/dry-run unless server secrets are configured.
 * Exports AbdmService (FHIR, ABHA lookups) and PaymentsService (payment links) for other modules.
 */
@Module({
  imports: [PatientsModule, BillingModule],
  controllers: [IntegrationsController, IntegrationsPublicController, IntegrationsCallbacksController],
  providers: [
    { provide: INTEGRATIONS_CONFIG, useFactory: () => loadIntegrationsConfig() },
    {
      provide: WEBHOOK_TRANSPORT,
      inject: [INTEGRATIONS_CONFIG],
      useFactory: (c: IntegrationsConfig) => (c.webhooksLive ? new HttpWebhookTransport() : new DryRunWebhookTransport()),
    },
    IntegrationsRepository,
    IntegrationSettingsService,
    AbdmService,
    PaymentsService,
    DeveloperService,
    DevicesService,
    ApiKeyGuard,
  ],
  exports: [AbdmService, PaymentsService],
})
export class IntegrationsModule {}
