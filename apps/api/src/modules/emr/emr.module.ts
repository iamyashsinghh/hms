import { Module, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../common/events/event-bus';
import { requestContext } from '../../common/context/request-context';
import { BillingModule } from '../billing/billing.module';
import { PatientsModule } from '../patients/patients.module';
import { SetupModule } from '../setup/setup.module';
import { EmrController } from './emr.controller';
import { EmrRepository } from './emr.repository';
import { EmrService, type OrderStatusChanged, type VisitCheckedIn } from './emr.service';

/**
 * OPD / EMR: doctor's queue, consultations (vitals, notes, ICD-10 diagnoses, orders), e-prescriptions
 * with favourites and allergy check, sign & lock, addenda, certificates, patient timeline. Signing posts
 * procedure orders picked from the billing service master as charges (ChargesService).
 * Other modules import EmrModule and use EmrService.
 */
@Module({ imports: [PatientsModule, SetupModule, BillingModule], controllers: [EmrController], providers: [EmrService, EmrRepository], exports: [EmrService] })
export class EmrModule implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly emr: EmrService,
  ) {}

  onModuleInit() {
    // A checked-in patient appears in the doctor's queue. Idempotent per visitId.
    this.bus.on<VisitCheckedIn>('frontoffice.visit.checked_in', (e) =>
      requestContext.run(
        { requestId: `event:${e.id}`, tenantId: e.tenantId, facilityId: e.payload.facilityId, roles: [], permissions: new Set(), facilityIds: 'all' },
        () => this.emr.openFromCheckIn(e.payload).then(() => undefined),
      ),
    );

    // Lab and radiology report progress on the orders the doctor placed. Idempotent; never moves backwards.
    for (const topic of ['radiology.order.status_changed', 'lab.order.status_changed']) {
      this.bus.on<OrderStatusChanged>(topic, (e) =>
        requestContext.run(
          { requestId: `event:${e.id}`, tenantId: e.tenantId, roles: [], permissions: new Set(), facilityIds: 'all' },
          () => this.emr.mirrorOrderStatus(e.payload),
        ),
      );
    }
  }
}
