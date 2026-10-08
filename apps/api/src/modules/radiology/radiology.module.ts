import { Module, OnModuleInit } from '@nestjs/common';
import type { billing as B } from '@hms/shared';
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
 * scan workflow, versioned reports with sign-off and print. Posts each order's charge to the patient's
 * account (ChargesService) and keeps the bill number when it is billed (billing.charges.billed).
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

    // Radiology charges billed at the billing desk (or by Collect now): keep the bill number on the order.
    this.bus.on<B.ChargesBilledEvent>('billing.charges.billed', (e) =>
      requestContext.run(
        { requestId: `event:${e.id}`, tenantId: e.tenantId, roles: [], permissions: new Set(), facilityIds: 'all' },
        () => this.radiology.recordBilled(e.payload).then(() => undefined),
      ),
    );
  }
}
