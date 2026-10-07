import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { quality as Q, type Paginated } from '@hms/shared';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { DbService } from '../../common/db/db.service';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { RequireEntitlement } from '../platform';
import { AuditsService } from './audits.service';
import { CapaService } from './capa.service';
import { ComplaintsService } from './complaints.service';
import { DocumentsService } from './documents.service';
import { HaiService } from './hai.service';
import { IncidentsService } from './incidents.service';
import { IndicatorsService } from './indicators.service';
import { QualityRepository } from './quality.repository';
import { istDate } from './quality.util';

const uuid = new ParseUUIDPipe();
const code = z.string().regex(/^[A-Z0-9-]{2,20}$/);
const censusQuery = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() });
const checklistQuery = z.object({ all: z.enum(['true', 'false']).optional() });

type Out<S extends z.ZodType> = z.output<S>;

/** Quality & NABH is a Growth-plan module. */
@Controller('quality')
@RequireEntitlement('quality')
export class QualityController {
  constructor(
    private readonly db: DbService,
    private readonly repo: QualityRepository,
    private readonly incidents: IncidentsService,
    private readonly complaints: ComplaintsService,
    private readonly hai: HaiService,
    private readonly audits: AuditsService,
    private readonly capas: CapaService,
    private readonly documents: DocumentsService,
    private readonly indicators: IndicatorsService,
  ) {}

  // ---------- dashboard and indicators ----------

  @Get('dashboard')
  @RequirePermissions('quality.indicator.read')
  dashboard(@Query(new ZodPipe(Q.indicatorQuerySchema)) q: Out<typeof Q.indicatorQuerySchema>): Promise<Q.QualityDashboard> {
    return this.indicators.dashboard(q.period);
  }

  @Get('indicators')
  @RequirePermissions('quality.indicator.read')
  listIndicators(@Query(new ZodPipe(Q.indicatorQuerySchema)) q: Out<typeof Q.indicatorQuerySchema>): Promise<Q.IndicatorResult[]> {
    return this.indicators.list(q);
  }

  @Get('indicators/:code/trend')
  @RequirePermissions('quality.indicator.read')
  trend(
    @Param('code', new ZodPipe(code)) c: string,
    @Query(new ZodPipe(Q.indicatorTrendQuerySchema)) q: Out<typeof Q.indicatorTrendQuerySchema>,
  ): Promise<Q.IndicatorResult[]> {
    return this.indicators.trend(c, q.months, q.to);
  }

  @Put('indicators/:code/values')
  @RequirePermissions('quality.indicator.manage')
  saveIndicatorValue(
    @Param('code', new ZodPipe(code)) c: string,
    @Body(new ZodPipe(Q.indicatorValueInputSchema)) body: Out<typeof Q.indicatorValueInputSchema>,
  ): Promise<Q.IndicatorResult> {
    return this.indicators.saveValue(c, body);
  }

  @Get('staff')
  @RequirePermissions('quality.capa.manage')
  staff(): Promise<Q.Person[]> {
    return this.db.tx((tx) => this.repo.staff(tx));
  }

  // ---------- incidents ----------

  @Post('incidents')
  @RequirePermissions('quality.incident.report')
  report(@Body(new ZodPipe(Q.reportIncidentSchema)) body: Out<typeof Q.reportIncidentSchema>): Promise<Q.Incident> {
    return this.incidents.report(body);
  }

  @Get('incidents')
  @RequirePermissions('quality.incident.read')
  listIncidents(@Query(new ZodPipe(Q.incidentQuerySchema)) q: Out<typeof Q.incidentQuerySchema>): Promise<Paginated<Q.IncidentSummary>> {
    return this.incidents.list(q);
  }

  @Get('incidents/mine')
  @RequirePermissions('quality.incident.report')
  myIncidents(@Query(new ZodPipe(Q.incidentQuerySchema)) q: Out<typeof Q.incidentQuerySchema>): Promise<Paginated<Q.IncidentSummary>> {
    return this.incidents.mine(q);
  }

  /** Managers see every incident; reporters only their own (checked in the service). */
  @Get('incidents/:id')
  @RequirePermissions('quality.incident.report')
  getIncident(@Param('id', uuid) id: string): Promise<Q.Incident> {
    return this.incidents.get(id);
  }

  @Patch('incidents/:id')
  @RequirePermissions('quality.incident.manage')
  reviewIncident(@Param('id', uuid) id: string, @Body(new ZodPipe(Q.reviewIncidentSchema)) body: Out<typeof Q.reviewIncidentSchema>): Promise<Q.Incident> {
    return this.incidents.review(id, body);
  }

  // ---------- complaints ----------

  @Post('complaints')
  @RequirePermissions('quality.complaint.create')
  createComplaint(@Body(new ZodPipe(Q.createComplaintSchema)) body: Out<typeof Q.createComplaintSchema>): Promise<Q.Complaint> {
    return this.complaints.create(body);
  }

  @Get('complaints')
  @RequirePermissions('quality.complaint.read')
  listComplaints(@Query(new ZodPipe(Q.complaintQuerySchema)) q: Out<typeof Q.complaintQuerySchema>): Promise<Paginated<Q.ComplaintSummary>> {
    return this.complaints.list(q);
  }

  @Get('complaints/:id')
  @RequirePermissions('quality.complaint.read')
  getComplaint(@Param('id', uuid) id: string): Promise<Q.Complaint> {
    return this.complaints.get(id);
  }

  @Patch('complaints/:id')
  @RequirePermissions('quality.complaint.manage')
  updateComplaint(@Param('id', uuid) id: string, @Body(new ZodPipe(Q.updateComplaintSchema)) body: Out<typeof Q.updateComplaintSchema>): Promise<Q.Complaint> {
    return this.complaints.update(id, body);
  }

  // ---------- infection control ----------

  @Post('hai')
  @RequirePermissions('quality.hai.manage')
  createHai(@Body(new ZodPipe(Q.createHaiSchema)) body: Out<typeof Q.createHaiSchema>): Promise<Q.HaiCase> {
    return this.hai.create(body);
  }

  @Get('hai')
  @RequirePermissions('quality.hai.read')
  listHai(@Query(new ZodPipe(Q.haiQuerySchema)) q: Out<typeof Q.haiQuerySchema>): Promise<Paginated<Q.HaiCase>> {
    return this.hai.list(q);
  }

  @Get('hai/:id')
  @RequirePermissions('quality.hai.read')
  getHai(@Param('id', uuid) id: string): Promise<Q.HaiCase> {
    return this.hai.get(id);
  }

  @Patch('hai/:id')
  @RequirePermissions('quality.hai.manage')
  updateHai(@Param('id', uuid) id: string, @Body(new ZodPipe(Q.updateHaiSchema)) body: Out<typeof Q.updateHaiSchema>): Promise<Q.HaiCase> {
    return this.hai.update(id, body);
  }

  @Put('census')
  @RequirePermissions('quality.census.manage')
  saveCensus(@Body(new ZodPipe(Q.censusInputSchema)) body: Out<typeof Q.censusInputSchema>): Promise<Q.CensusDay> {
    return this.hai.saveCensus(body);
  }

  @Get('census')
  @RequirePermissions('quality.hai.read')
  listCensus(@Query(new ZodPipe(censusQuery)) q: z.infer<typeof censusQuery>): Promise<Q.CensusDay[]> {
    const to = q.to ?? istDate();
    const from = q.from ?? istDate(new Date(new Date(`${to}T00:00:00Z`).getTime() - 30 * 86_400_000));
    return this.hai.listCensus(from, to);
  }

  // ---------- checklists and audits ----------

  @Get('checklists')
  @RequirePermissions('quality.audit.read')
  listChecklists(@Query(new ZodPipe(checklistQuery)) q: z.infer<typeof checklistQuery>): Promise<Q.Checklist[]> {
    return this.audits.listChecklists(q.all === 'true');
  }

  @Get('checklists/:id')
  @RequirePermissions('quality.audit.read')
  getChecklist(@Param('id', uuid) id: string): Promise<Q.Checklist> {
    return this.audits.getChecklist(id);
  }

  @Post('checklists')
  @RequirePermissions('quality.checklist.manage')
  createChecklist(@Body(new ZodPipe(Q.checklistInputSchema)) body: Out<typeof Q.checklistInputSchema>): Promise<Q.Checklist> {
    return this.audits.saveChecklist(null, body);
  }

  @Put('checklists/:id')
  @RequirePermissions('quality.checklist.manage')
  updateChecklist(@Param('id', uuid) id: string, @Body(new ZodPipe(Q.checklistInputSchema)) body: Out<typeof Q.checklistInputSchema>): Promise<Q.Checklist> {
    return this.audits.saveChecklist(id, body);
  }

  @Get('audits')
  @RequirePermissions('quality.audit.read')
  listAudits(@Query(new ZodPipe(Q.auditQuerySchema)) q: Out<typeof Q.auditQuerySchema>): Promise<Paginated<Q.AuditSummary>> {
    return this.audits.list(q);
  }

  @Get('audits/:id')
  @RequirePermissions('quality.audit.read')
  getAudit(@Param('id', uuid) id: string): Promise<Q.Audit> {
    return this.audits.get(id);
  }

  @Post('audits')
  @RequirePermissions('quality.audit.conduct')
  scheduleAudit(@Body(new ZodPipe(Q.scheduleAuditSchema)) body: Out<typeof Q.scheduleAuditSchema>): Promise<Q.Audit> {
    return this.audits.schedule(body);
  }

  @Post('audits/:id/submit')
  @HttpCode(200)
  @RequirePermissions('quality.audit.conduct')
  submitAudit(@Param('id', uuid) id: string, @Body(new ZodPipe(Q.submitAuditSchema)) body: Out<typeof Q.submitAuditSchema>): Promise<Q.Audit> {
    return this.audits.submit(id, body);
  }

  @Post('audits/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('quality.audit.conduct')
  cancelAudit(@Param('id', uuid) id: string): Promise<Q.Audit> {
    return this.audits.cancel(id);
  }

  // ---------- CAPA ----------

  @Post('capas')
  @RequirePermissions('quality.capa.manage')
  createCapa(@Body(new ZodPipe(Q.createCapaSchema)) body: Out<typeof Q.createCapaSchema>): Promise<Q.Capa> {
    return this.capas.create(body);
  }

  @Get('capas')
  @RequirePermissions('quality.capa.read')
  listCapas(@Query(new ZodPipe(Q.capaQuerySchema)) q: Out<typeof Q.capaQuerySchema>): Promise<Paginated<Q.CapaSummary>> {
    return this.capas.list(q);
  }

  @Get('capas/:id')
  @RequirePermissions('quality.capa.read')
  getCapa(@Param('id', uuid) id: string): Promise<Q.Capa> {
    return this.capas.get(id);
  }

  @Patch('capas/:id')
  @RequirePermissions('quality.capa.manage')
  updateCapa(@Param('id', uuid) id: string, @Body(new ZodPipe(Q.updateCapaSchema)) body: Out<typeof Q.updateCapaSchema>): Promise<Q.Capa> {
    return this.capas.update(id, body);
  }

  // ---------- NABH documents ----------

  @Get('documents')
  @RequirePermissions('quality.document.read')
  listDocuments(@Query(new ZodPipe(Q.documentQuerySchema)) q: Out<typeof Q.documentQuerySchema>): Promise<Paginated<Q.DocumentSummary>> {
    return this.documents.list(q);
  }

  @Get('documents/:id')
  @RequirePermissions('quality.document.read')
  getDocument(@Param('id', uuid) id: string): Promise<Q.QualityDocument> {
    return this.documents.get(id);
  }

  @Post('documents')
  @RequirePermissions('quality.document.manage')
  createDocument(@Body(new ZodPipe(Q.createDocumentSchema)) body: Out<typeof Q.createDocumentSchema>): Promise<Q.QualityDocument> {
    return this.documents.create(body);
  }

  @Patch('documents/:id')
  @RequirePermissions('quality.document.manage')
  updateDocument(@Param('id', uuid) id: string, @Body(new ZodPipe(Q.updateDocumentSchema)) body: Out<typeof Q.updateDocumentSchema>): Promise<Q.QualityDocument> {
    return this.documents.update(id, body);
  }

  @Post('documents/:id/approve')
  @HttpCode(200)
  @RequirePermissions('quality.document.manage')
  approveDocument(@Param('id', uuid) id: string): Promise<Q.QualityDocument> {
    return this.documents.approve(id);
  }

  @Post('documents/:id/revise')
  @RequirePermissions('quality.document.manage')
  reviseDocument(@Param('id', uuid) id: string): Promise<Q.QualityDocument> {
    return this.documents.revise(id);
  }

  @Post('documents/:id/archive')
  @HttpCode(200)
  @RequirePermissions('quality.document.manage')
  archiveDocument(@Param('id', uuid) id: string): Promise<Q.QualityDocument> {
    return this.documents.archive(id);
  }
}
