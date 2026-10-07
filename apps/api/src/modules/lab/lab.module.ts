import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../common/events/event-bus';
import { requestContext } from '../../common/context/request-context';
import { BillingModule } from '../billing/billing.module';
import { EmrModule } from '../emr/emr.module';
import { PatientsModule } from '../patients/patients.module';
import { SetupModule } from '../setup/setup.module';
import { LabController } from './lab.controller';
import { LabRepository } from './lab.repository';
import { LabService, type DeviceResultsReceived } from './lab.service';

/**
 * Laboratory (LIS): test/panel catalogue with reference ranges, orders (walk-in, from signed
 * consultations, B2B), sample barcodes and collection, result entry with flags and critical alerts,
 * verification and the printable report. Publishes lab.order.created, lab.result.critical,
 * lab.report.verified and lab.order.cancelled. Consumes emr.encounter.signed and
 * integrations.device.results_received. Bills through BillingService.
 */
@Module({
  imports: [PatientsModule, BillingModule, SetupModule, EmrModule],
  controllers: [LabController],
  providers: [LabService, LabRepository],
  exports: [LabService],
})
export class LabModule implements OnModuleInit {
  private readonly logger = new Logger(LabModule.name);

  constructor(
    private readonly bus: EventBus,
    private readonly lab: LabService,
  ) {}

  onModuleInit() {
    // Lab lines on a signed consultation become a lab order. Idempotent per consultation.
    this.bus.on<{ encounterId: string }>('emr.encounter.signed', (e) =>
      requestContext.run(
        { requestId: `event:${e.id}`, tenantId: e.tenantId, facilityId: null, roles: [], permissions: new Set(), facilityIds: 'all' },
        async () => {
          const order = await this.lab.createFromEncounter(e.payload.encounterId);
          if (order) this.logger.log(`lab order ${order.orderNo} from consultation ${e.payload.encounterId}`);
        },
      ),
    );

    // Results from a lab analyser (integrations module), matched by tube barcode.
    this.bus.on<DeviceResultsReceived>('integrations.device.results_received', (e) =>
      requestContext.run(
        { requestId: `event:${e.id}`, tenantId: e.tenantId, facilityId: null, roles: [], permissions: new Set(), facilityIds: 'all' },
        async () => {
          const done = await this.lab.applyDeviceResults(e.payload);
          if (!done) this.logger.warn(`device results for unknown or closed sample ${e.payload.sampleId}`);
        },
      ),
    );
  }
}
