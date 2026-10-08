import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { crm, type Paginated } from '@hms/shared';
import { z } from 'zod';
import { Ctx, RequirePermissions } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/context/request-context';
import { forbidden } from '../../common/errors/errors';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { RequireEntitlement } from '../platform';
import { CampsService } from './camps.service';
import { CrmDashboardService } from './dashboard.service';
import { FollowUpsService } from './followups.service';
import { LeadsService } from './leads.service';
import { ReferralsService } from './referrals.service';

const uuid = new ParseUUIDPipe();
const rulesQuery = z.object({ referrerId: z.uuid().optional() });
const remindDueBody = z.object({ date: z.iso.date().optional() });

/** Referral & CRM routes under /api/v1/crm. Services do the parsing; the pipes here give 400s early. */
@Controller('crm')
@RequireEntitlement('crm')
export class CrmController {
  constructor(
    private readonly leads: LeadsService,
    private readonly referrals: ReferralsService,
    private readonly camps: CampsService,
    private readonly followUps: FollowUpsService,
    private readonly dashboard: CrmDashboardService,
  ) {}

  @Get('dashboard')
  @RequirePermissions('crm.lead.read')
  getDashboard(): Promise<crm.CrmDashboard> {
    return this.dashboard.get();
  }

  /** Active staff who can own an enquiry or a follow-up (for the assignee pickers). */
  @Get('staff')
  listStaff(@Ctx() ctx: RequestContext): Promise<crm.CrmStaff[]> {
    if (!ctx.permissions.has('crm.lead.manage') && !ctx.permissions.has('crm.followup.manage')) throw forbidden();
    return this.leads.staff();
  }

  // ---------- leads ----------

  @Get('leads')
  @RequirePermissions('crm.lead.read')
  listLeads(@Query(new ZodPipe(crm.leadQuerySchema)) q: crm.LeadQuery): Promise<Paginated<crm.Lead>> {
    return this.leads.list(q);
  }

  @Get('leads/:id')
  @RequirePermissions('crm.lead.read')
  getLead(@Param('id', uuid) id: string): Promise<crm.LeadDetail> {
    return this.leads.get(id);
  }

  @Post('leads')
  @RequirePermissions('crm.lead.manage')
  createLead(@Body(new ZodPipe(crm.leadInputSchema)) body: crm.LeadInput): Promise<crm.LeadDetail> {
    return this.leads.create(body);
  }

  @Patch('leads/:id')
  @RequirePermissions('crm.lead.manage')
  updateLead(@Param('id', uuid) id: string, @Body(new ZodPipe(crm.updateLeadSchema)) body: crm.UpdateLead): Promise<crm.LeadDetail> {
    return this.leads.update(id, body);
  }

  @Post('leads/:id/activities')
  @RequirePermissions('crm.lead.manage')
  addActivity(@Param('id', uuid) id: string, @Body(new ZodPipe(crm.leadActivityInputSchema)) body: crm.LeadActivityInput): Promise<crm.LeadDetail> {
    return this.leads.addActivity(id, body);
  }

  @Post('leads/:id/lose')
  @HttpCode(200)
  @RequirePermissions('crm.lead.manage')
  loseLead(@Param('id', uuid) id: string, @Body(new ZodPipe(crm.loseLeadSchema)) body: crm.LoseLead): Promise<crm.LeadDetail> {
    return this.leads.lose(id, body);
  }

  @Post('leads/:id/reopen')
  @HttpCode(200)
  @RequirePermissions('crm.lead.manage')
  reopenLead(@Param('id', uuid) id: string): Promise<crm.LeadDetail> {
    return this.leads.reopen(id);
  }

  @Post('leads/:id/convert')
  @HttpCode(200)
  @RequirePermissions('crm.lead.manage', 'core.patient.read')
  convertLead(@Param('id', uuid) id: string, @Body(new ZodPipe(crm.convertLeadSchema)) body: crm.ConvertLead): Promise<crm.LeadDetail> {
    return this.leads.convert(id, body);
  }

  // ---------- referrers and commission rules ----------

  @Get('referrers')
  @RequirePermissions('crm.referrer.read')
  listReferrers(@Query(new ZodPipe(crm.referrerQuerySchema)) q: crm.ReferrerQuery): Promise<Paginated<crm.ReferrerSummary>> {
    return this.referrals.listReferrers(q);
  }

  @Get('referrers/:id')
  @RequirePermissions('crm.referrer.read')
  getReferrer(@Param('id', uuid) id: string): Promise<crm.ReferrerSummary> {
    return this.referrals.getReferrer(id);
  }

  @Post('referrers')
  @RequirePermissions('crm.referrer.manage')
  createReferrer(@Body(new ZodPipe(crm.referrerInputSchema)) body: crm.ReferrerInput): Promise<crm.Referrer> {
    return this.referrals.createReferrer(body);
  }

  @Patch('referrers/:id')
  @RequirePermissions('crm.referrer.manage')
  updateReferrer(@Param('id', uuid) id: string, @Body(new ZodPipe(crm.updateReferrerSchema)) body: crm.UpdateReferrer): Promise<crm.Referrer> {
    return this.referrals.updateReferrer(id, body);
  }

  @Get('commission-rules')
  @RequirePermissions('crm.referrer.read')
  listRules(@Query(new ZodPipe(rulesQuery)) q: z.infer<typeof rulesQuery>): Promise<crm.CommissionRule[]> {
    return this.referrals.listRules(q.referrerId);
  }

  @Post('commission-rules')
  @RequirePermissions('crm.referrer.manage')
  createRule(@Body(new ZodPipe(crm.commissionRuleInputSchema)) body: crm.CommissionRuleInput): Promise<crm.CommissionRule> {
    return this.referrals.createRule(body);
  }

  @Put('commission-rules/:id')
  @RequirePermissions('crm.referrer.manage')
  updateRule(@Param('id', uuid) id: string, @Body(new ZodPipe(crm.commissionRuleInputSchema)) body: crm.CommissionRuleInput): Promise<crm.CommissionRule> {
    return this.referrals.updateRule(id, body);
  }

  // ---------- referrals ----------

  @Get('referrals')
  @RequirePermissions('crm.referrer.read')
  listReferrals(@Query(new ZodPipe(crm.referralQuerySchema)) q: crm.ReferralQuery): Promise<Paginated<crm.Referral>> {
    return this.referrals.listReferrals(q);
  }

  @Post('referrals')
  @RequirePermissions('crm.referral.create')
  createReferral(@Body(new ZodPipe(crm.referralInputSchema)) body: crm.ReferralInput): Promise<crm.Referral> {
    return this.referrals.createReferral(body);
  }

  @Post('referrals/:id/close')
  @HttpCode(200)
  @RequirePermissions('crm.referral.create')
  closeReferral(@Param('id', uuid) id: string): Promise<crm.Referral> {
    return this.referrals.closeReferral(id);
  }

  // ---------- commissions and statements ----------

  @Get('commissions')
  @RequirePermissions('crm.commission.read')
  listCommissions(@Query(new ZodPipe(crm.commissionQuerySchema)) q: crm.CommissionQuery): Promise<Paginated<crm.Commission>> {
    return this.referrals.listCommissions(q);
  }

  @Get('statements')
  @RequirePermissions('crm.commission.read')
  listStatements(@Query(new ZodPipe(crm.statementQuerySchema)) q: crm.StatementQuery): Promise<Paginated<crm.CommissionStatement>> {
    return this.referrals.listStatements(q);
  }

  @Get('statements/:id')
  @RequirePermissions('crm.commission.read')
  getStatement(@Param('id', uuid) id: string): Promise<crm.CommissionStatementDetail> {
    return this.referrals.getStatement(id);
  }

  @Post('statements')
  @RequirePermissions('crm.commission.manage')
  createStatement(@Body(new ZodPipe(crm.createStatementSchema)) body: crm.CreateStatement): Promise<crm.CommissionStatementDetail> {
    return this.referrals.createStatement(body);
  }

  @Post('statements/:id/approve')
  @HttpCode(200)
  @RequirePermissions('crm.commission.manage')
  approveStatement(@Param('id', uuid) id: string): Promise<crm.CommissionStatementDetail> {
    return this.referrals.approveStatement(id);
  }

  @Post('statements/:id/pay')
  @HttpCode(200)
  @RequirePermissions('crm.commission.pay')
  payStatement(@Param('id', uuid) id: string, @Body(new ZodPipe(crm.payStatementSchema)) body: crm.PayStatement): Promise<crm.CommissionStatementDetail> {
    return this.referrals.payStatement(id, body);
  }

  @Post('statements/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('crm.commission.manage')
  cancelStatement(@Param('id', uuid) id: string): Promise<crm.CommissionStatementDetail> {
    return this.referrals.cancelStatement(id);
  }

  // ---------- camps ----------

  @Get('camps')
  @RequirePermissions('crm.camp.read')
  listCamps(@Query(new ZodPipe(crm.campQuerySchema)) q: crm.CampQuery): Promise<Paginated<crm.Camp>> {
    return this.camps.listCamps(q);
  }

  @Get('camps/:id')
  @RequirePermissions('crm.camp.read')
  getCamp(@Param('id', uuid) id: string): Promise<crm.Camp> {
    return this.camps.getCamp(id);
  }

  @Post('camps')
  @RequirePermissions('crm.camp.manage')
  createCamp(@Body(new ZodPipe(crm.campInputSchema)) body: crm.CampInput): Promise<crm.Camp> {
    return this.camps.createCamp(body);
  }

  @Patch('camps/:id')
  @RequirePermissions('crm.camp.manage')
  updateCamp(@Param('id', uuid) id: string, @Body(new ZodPipe(crm.updateCampSchema)) body: crm.UpdateCamp): Promise<crm.Camp> {
    return this.camps.updateCamp(id, body);
  }

  // ---------- campaigns ----------

  @Get('campaigns')
  @RequirePermissions('crm.campaign.manage')
  listCampaigns(): Promise<crm.Campaign[]> {
    return this.camps.listCampaigns();
  }

  @Get('campaigns/:id')
  @RequirePermissions('crm.campaign.manage')
  getCampaign(@Param('id', uuid) id: string): Promise<crm.Campaign> {
    return this.camps.getCampaign(id);
  }

  @Post('campaigns')
  @RequirePermissions('crm.campaign.manage')
  createCampaign(@Body(new ZodPipe(crm.campaignInputSchema)) body: crm.CampaignInput): Promise<crm.Campaign> {
    return this.camps.createCampaign(body);
  }

  @Put('campaigns/:id')
  @RequirePermissions('crm.campaign.manage')
  updateCampaign(@Param('id', uuid) id: string, @Body(new ZodPipe(crm.campaignInputSchema)) body: crm.CampaignInput): Promise<crm.Campaign> {
    return this.camps.updateCampaign(id, body);
  }

  @Post('campaigns/:id/send')
  @HttpCode(200)
  @RequirePermissions('crm.campaign.manage')
  sendCampaign(@Param('id', uuid) id: string): Promise<crm.Campaign> {
    return this.camps.sendCampaign(id);
  }

  @Post('campaigns/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('crm.campaign.manage')
  cancelCampaign(@Param('id', uuid) id: string): Promise<crm.Campaign> {
    return this.camps.cancelCampaign(id);
  }

  // ---------- follow-ups ----------

  @Get('follow-ups')
  @RequirePermissions('crm.followup.read')
  listFollowUps(@Query(new ZodPipe(crm.followUpQuerySchema)) q: crm.FollowUpQuery): Promise<Paginated<crm.FollowUp>> {
    return this.followUps.list(q);
  }

  @Post('follow-ups/remind-due')
  @HttpCode(200)
  @RequirePermissions('crm.followup.manage')
  remindDue(@Body(new ZodPipe(remindDueBody)) body: z.infer<typeof remindDueBody>): Promise<crm.RemindDueResult> {
    return this.followUps.remindDue(body.date);
  }

  @Get('follow-ups/:id')
  @RequirePermissions('crm.followup.read')
  getFollowUp(@Param('id', uuid) id: string): Promise<crm.FollowUp> {
    return this.followUps.get(id);
  }

  @Post('follow-ups')
  @RequirePermissions('crm.followup.manage')
  createFollowUp(@Body(new ZodPipe(crm.followUpInputSchema)) body: crm.FollowUpInput): Promise<crm.FollowUp> {
    return this.followUps.create(body);
  }

  @Patch('follow-ups/:id')
  @RequirePermissions('crm.followup.manage')
  updateFollowUp(@Param('id', uuid) id: string, @Body(new ZodPipe(crm.updateFollowUpSchema)) body: crm.UpdateFollowUp): Promise<crm.FollowUp> {
    return this.followUps.update(id, body);
  }

  @Post('follow-ups/:id/close')
  @HttpCode(200)
  @RequirePermissions('crm.followup.manage')
  closeFollowUp(@Param('id', uuid) id: string, @Body(new ZodPipe(crm.closeFollowUpSchema)) body: crm.CloseFollowUp): Promise<crm.FollowUp> {
    return this.followUps.close(id, body);
  }

  @Post('follow-ups/:id/remind')
  @HttpCode(200)
  @RequirePermissions('crm.followup.manage')
  remind(@Param('id', uuid) id: string, @Body(new ZodPipe(crm.remindFollowUpSchema)) body: crm.RemindFollowUp) {
    return this.followUps.remind(id, body);
  }
}
