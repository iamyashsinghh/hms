import { Module, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EventBus } from '../../common/events/event-bus';
import { requestContext } from '../../common/context/request-context';
import { PatientsModule } from '../patients/patients.module';
import { EmrController } from './emr.controller';
import { EmrRepository } from './emr.repository';
import { EmrService, type VisitCheckedIn } from './emr.service';

/**
 * OPD / EMR: doctor's queue, consultations (vitals, notes, ICD-10 diagnoses, orders), e-prescriptions
 * with favourites and allergy check, sign & lock, addenda, certificates, patient timeline.
 * Other modules import EmrModule and use EmrService.
 */
@Module({ imports: [PatientsModule], controllers: [EmrController], providers: [EmrService, EmrRepository], exports: [EmrService] })
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
  }
}
