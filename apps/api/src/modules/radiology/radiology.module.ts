import { Module, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../common/events/event-bus';
import { requestContext } from '../../common/context/request-context';
import { BillingModule } from '../billing/billing.module';
import { EmrModule } from '../emr/emr.module';
import { PatientsModule } from '../patients/patients.module';
import { RadiologyController } from './radiology.controller';
import { RadiologyRepository } from './radiology.repository';
import { RadiologyService, type EncounterSigned } from './radiology.service';

/**
 * Radiology (RIS): modality / test / template masters, orders (from EMR or the desk), machine schedule,
 * scan workflow, versioned reports with sign-off and print, billing through BillingService.
 * Publishes radiology.order.status_changed, radiology.report.finalized and radiology.report.critical.
 */
@Module({
  imports: [PatientsModule, BillingModule, EmrModule],
  controllers: [RadiologyController],
  providers: [RadiologyService, RadiologyRepository],
  exports: [RadiologyService],
})
export class RadiologyModule implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly radiology: RadiologyService,
  ) {}

  onModuleInit() {
    // A signed consultation's radiology order lines land on the worklist. Idempotent per EMR order line.
    this.bus.on<EncounterSigned>('emr.encounter.signed', (e) =>
      requestContext.run(
        { requestId: `event:${e.id}`, tenantId: e.tenantId, roles: [], permissions: new Set(), facilityIds: 'all' },
        () => this.radiology.importFromEncounter(e.payload).then(() => undefined),
      ),
    );
  }
}
