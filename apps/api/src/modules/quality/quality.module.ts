import { Module, OnModuleInit } from '@nestjs/common';
import { eq, qualityComplaints, qualityHaiCases, qualityIncidents } from '@hms/db';
import { DbService } from '../../common/db/db.service';
import { EventBus } from '../../common/events/event-bus';
import { AuditsService } from './audits.service';
import { CapaService } from './capa.service';
import { ComplaintsService } from './complaints.service';
import { DocumentsService } from './documents.service';
import { HaiService, IPD_CENSUS_TOPIC, type IpdCensusDaily } from './hai.service';
import { IncidentsService } from './incidents.service';
import { FACT_TOPICS, IndicatorsService } from './indicators.service';
import { QualityController } from './quality.controller';
import { QualityRepository } from './quality.repository';

/**
 * Quality & NABH: incident / near-miss reporting, patient complaints, infection control (HAI),
 * audits and checklists, CAPA, NABH document library and quality indicators.
 * Publishes quality.incident.reported / quality.incident.closed / quality.complaint.registered /
 * quality.complaint.resolved (payloads in packages/shared/src/modules/quality.ts).
 * Consumes other modules' events only to count indicator denominators (OPD visits, prescriptions, IPD census);
 * never reads their tables.
 */
@Module({
  controllers: [QualityController],
  providers: [QualityRepository, IncidentsService, ComplaintsService, HaiService, AuditsService, CapaService, DocumentsService, IndicatorsService],
  exports: [IncidentsService, IndicatorsService],
})
export class QualityModule implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly db: DbService,
    private readonly indicators: IndicatorsService,
    private readonly hai: HaiService,
  ) {}

  onModuleInit() {
    for (const topic of Object.values(FACT_TOPICS)) this.bus.on(topic, (e) => this.indicators.recordFact(e));
    // IPD's daily census fills patient and device days; manual census entry remains the fallback.
    this.bus.on<IpdCensusDaily>(IPD_CENSUS_TOPIC, (e) => this.hai.recordIpdCensus(e));

    // Merged duplicate patients: point quality records at the surviving patient. Idempotent.
    this.bus.on<{ sourceId: string; targetId: string }>('core.patient.merged', (e) =>
      this.db.asTenant({ tenantId: e.tenantId }, async (tx) => {
        const { sourceId, targetId } = e.payload;
        await tx.update(qualityIncidents).set({ patientId: targetId }).where(eq(qualityIncidents.patientId, sourceId));
        await tx.update(qualityComplaints).set({ patientId: targetId }).where(eq(qualityComplaints.patientId, sourceId));
        await tx.update(qualityHaiCases).set({ patientId: targetId }).where(eq(qualityHaiCases.patientId, sourceId));
      }),
    );
  }
}
