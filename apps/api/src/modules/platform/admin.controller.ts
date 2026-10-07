import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import {
  adminCreateTenantSchema,
  adminSetEntitlementsSchema,
  adminSetSubscriptionSchema,
  adminSetTenantStatusSchema,
  adminUpdateTenantSchema,
  createPlatformAdminSchema,
  invoiceListQuerySchema,
  markInvoicePaidSchema,
  paginationQuerySchema,
  planCodeSchema,
  platformLoginSchema,
  tenantListQuerySchema,
  ticketListQuerySchema,
  ticketReplySchema,
  updateAnnouncementSchema,
  updateHelpArticleSchema,
  updatePlanSchema,
  updatePlatformAdminSchema,
  updateTicketSchema,
  upsertAnnouncementSchema,
  upsertHelpArticleSchema,
  upsertPlanSchema,
  type AdminAuditEntry,
  type Announcement,
  type HelpArticle,
  type LifecycleRunResult,
  type Paginated,
  type Plan,
  type PlatformAdmin,
  type PlatformDashboard,
  type PlatformLoginResponse,
  type SignupResult,
  type SubscriptionInvoice,
  type TenantDetail,
  type TenantSummary,
  type Ticket,
  type TicketDetail,
} from './contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { AdminAuthService, toAdmin } from './admin-auth.service';
import { AdminService } from './admin.service';
import { CurrentAdmin, PlatformAdminGuard, PlatformPublic, PlatformRoles, type PlatformPrincipal } from './platform-admin.guard';
import { SubscriptionsService } from './subscriptions.service';
import { TicketsService } from './tickets.service';

const auditQuerySchema = paginationQuerySchema.extend({ tenantId: z.uuid().optional() });

/**
 * Super-admin console API. @Public() for the staff AuthGuard; PlatformAdminGuard accepts only
 * platform-admin tokens. Mutations that change money, plans or platform users need super_admin.
 */
@Public()
@UseGuards(PlatformAdminGuard)
@Controller('platform/admin')
export class PlatformAdminController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly admin: AdminService,
    private readonly subs: SubscriptionsService,
    private readonly tickets: TicketsService,
  ) {}

  // ---------- auth ----------

  @PlatformPublic()
  @Post('auth/login')
  @HttpCode(200)
  login(@Body(new ZodPipe(platformLoginSchema)) body: z.output<typeof platformLoginSchema>, @Req() req: FastifyRequest): Promise<PlatformLoginResponse> {
    return this.auth.login(body.email, body.password, req.ip);
  }

  @Post('auth/logout')
  @HttpCode(204)
  logout(@CurrentAdmin() me: PlatformPrincipal): Promise<void> {
    return this.auth.logout(me.sessionId);
  }

  @Get('auth/me')
  async me(@CurrentAdmin() me: PlatformPrincipal): Promise<PlatformAdmin> {
    const all = await this.admin.listAdmins();
    const found = all.find((a) => a.id === me.id);
    return found ?? toAdmin({ id: me.id, email: me.email, name: me.name, role: me.role } as never);
  }

  // ---------- dashboard and hospitals ----------

  @Get('dashboard')
  dashboard(): Promise<PlatformDashboard> {
    return this.admin.dashboard();
  }

  @Get('tenants')
  tenants(@Query(new ZodPipe(tenantListQuerySchema)) q: z.output<typeof tenantListQuerySchema>): Promise<Paginated<TenantSummary>> {
    return this.admin.listTenants(q);
  }

  @Post('tenants')
  @PlatformRoles('super_admin')
  createTenant(@CurrentAdmin() me: PlatformPrincipal, @Body(new ZodPipe(adminCreateTenantSchema)) body: z.output<typeof adminCreateTenantSchema>): Promise<SignupResult> {
    return this.admin.createTenant(me, body);
  }

  @Get('tenants/:id')
  tenant(@Param('id', ParseUUIDPipe) id: string): Promise<TenantDetail> {
    return this.admin.tenantDetail(id);
  }

  @Patch('tenants/:id')
  @PlatformRoles('super_admin')
  updateTenant(
    @CurrentAdmin() me: PlatformPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(adminUpdateTenantSchema)) body: z.output<typeof adminUpdateTenantSchema>,
  ): Promise<TenantDetail> {
    return this.admin.updateTenant(me, id, body);
  }

  @Post('tenants/:id/status')
  @HttpCode(200)
  @PlatformRoles('super_admin')
  setStatus(
    @CurrentAdmin() me: PlatformPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(adminSetTenantStatusSchema)) body: z.output<typeof adminSetTenantStatusSchema>,
  ): Promise<TenantDetail> {
    return this.admin.setTenantStatus(me, id, body);
  }

  @Put('tenants/:id/subscription')
  @PlatformRoles('super_admin')
  setSubscription(
    @CurrentAdmin() me: PlatformPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(adminSetSubscriptionSchema)) body: z.output<typeof adminSetSubscriptionSchema>,
  ): Promise<TenantDetail> {
    return this.admin.setSubscription(me, id, body);
  }

  @Put('tenants/:id/entitlements')
  @PlatformRoles('super_admin')
  setEntitlements(
    @CurrentAdmin() me: PlatformPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(adminSetEntitlementsSchema)) body: z.output<typeof adminSetEntitlementsSchema>,
  ): Promise<TenantDetail> {
    return this.admin.setEntitlements(me, id, body);
  }

  // ---------- plans ----------

  @Get('plans')
  plans(): Promise<Plan[]> {
    return this.subs.listPlans({ includeHidden: true });
  }

  @Post('plans')
  @PlatformRoles('super_admin')
  createPlan(@CurrentAdmin() me: PlatformPrincipal, @Body(new ZodPipe(upsertPlanSchema)) body: z.output<typeof upsertPlanSchema>): Promise<Plan> {
    return this.admin.createPlan(me, body);
  }

  @Patch('plans/:code')
  @PlatformRoles('super_admin')
  updatePlan(
    @CurrentAdmin() me: PlatformPrincipal,
    @Param('code', new ZodPipe(planCodeSchema)) code: string,
    @Body(new ZodPipe(updatePlanSchema)) body: z.output<typeof updatePlanSchema>,
  ): Promise<Plan> {
    return this.admin.updatePlan(me, code, body);
  }

  // ---------- subscription invoices ----------

  @Get('invoices')
  invoices(@Query(new ZodPipe(invoiceListQuerySchema)) q: z.output<typeof invoiceListQuerySchema>): Promise<Paginated<SubscriptionInvoice & { tenantName: string }>> {
    return this.admin.listInvoices(q);
  }

  @Post('invoices/:id/mark-paid')
  @HttpCode(200)
  @PlatformRoles('super_admin')
  markPaid(
    @CurrentAdmin() me: PlatformPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(markInvoicePaidSchema)) body: z.output<typeof markInvoicePaidSchema>,
  ): Promise<SubscriptionInvoice> {
    return this.admin.markInvoicePaid(me, id, body);
  }

  @Post('invoices/:id/void')
  @HttpCode(200)
  @PlatformRoles('super_admin')
  voidInvoice(@CurrentAdmin() me: PlatformPrincipal, @Param('id', ParseUUIDPipe) id: string): Promise<SubscriptionInvoice> {
    return this.admin.voidInvoice(me, id);
  }

  // ---------- support tickets ----------

  @Get('tickets')
  listTickets(@Query(new ZodPipe(ticketListQuerySchema)) q: z.output<typeof ticketListQuerySchema>): Promise<Paginated<Ticket>> {
    return this.tickets.adminList(q);
  }

  @Get('tickets/:id')
  ticket(@Param('id', ParseUUIDPipe) id: string): Promise<TicketDetail> {
    return this.tickets.adminGet(id);
  }

  @Post('tickets/:id/messages')
  replyTicket(
    @CurrentAdmin() me: PlatformPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ticketReplySchema)) body: z.output<typeof ticketReplySchema>,
  ): Promise<TicketDetail> {
    return this.tickets.adminReply(id, me, body.body, body.isInternal);
  }

  @Patch('tickets/:id')
  updateTicket(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateTicketSchema)) body: z.output<typeof updateTicketSchema>): Promise<TicketDetail> {
    return this.tickets.adminUpdate(id, body);
  }

  // ---------- announcements and help ----------

  @Get('announcements')
  announcements(): Promise<Announcement[]> {
    return this.admin.listAnnouncements();
  }

  @Post('announcements')
  createAnnouncement(@CurrentAdmin() me: PlatformPrincipal, @Body(new ZodPipe(upsertAnnouncementSchema)) body: z.output<typeof upsertAnnouncementSchema>): Promise<Announcement> {
    return this.admin.createAnnouncement(me, body);
  }

  @Patch('announcements/:id')
  updateAnnouncement(
    @CurrentAdmin() me: PlatformPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateAnnouncementSchema)) body: z.output<typeof updateAnnouncementSchema>,
  ): Promise<Announcement> {
    return this.admin.updateAnnouncement(me, id, body);
  }

  @Get('help')
  help(): Promise<HelpArticle[]> {
    return this.admin.listHelp();
  }

  @Post('help')
  createHelp(@CurrentAdmin() me: PlatformPrincipal, @Body(new ZodPipe(upsertHelpArticleSchema)) body: z.output<typeof upsertHelpArticleSchema>): Promise<HelpArticle> {
    return this.admin.createHelp(me, body);
  }

  @Patch('help/:id')
  updateHelp(
    @CurrentAdmin() me: PlatformPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateHelpArticleSchema)) body: z.output<typeof updateHelpArticleSchema>,
  ): Promise<HelpArticle> {
    return this.admin.updateHelp(me, id, body);
  }

  // ---------- platform users, audit, jobs ----------

  @Get('admins')
  @PlatformRoles('super_admin')
  admins(): Promise<PlatformAdmin[]> {
    return this.admin.listAdmins();
  }

  @Post('admins')
  @PlatformRoles('super_admin')
  createAdmin(@CurrentAdmin() me: PlatformPrincipal, @Body(new ZodPipe(createPlatformAdminSchema)) body: z.output<typeof createPlatformAdminSchema>): Promise<PlatformAdmin> {
    return this.admin.createAdmin(me, body);
  }

  @Patch('admins/:id')
  @PlatformRoles('super_admin')
  updateAdmin(
    @CurrentAdmin() me: PlatformPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updatePlatformAdminSchema)) body: z.output<typeof updatePlatformAdminSchema>,
  ): Promise<PlatformAdmin> {
    return this.admin.updateAdmin(me, id, body);
  }

  @Get('audit')
  @PlatformRoles('super_admin')
  audit(@Query(new ZodPipe(auditQuerySchema)) q: z.output<typeof auditQuerySchema>): Promise<Paginated<AdminAuditEntry>> {
    return this.admin.auditLog(q.tenantId, q.page, q.pageSize);
  }

  @Post('lifecycle/run')
  @HttpCode(200)
  @PlatformRoles('super_admin')
  runLifecycle(@CurrentAdmin() me: PlatformPrincipal): Promise<LifecycleRunResult> {
    return this.admin.runLifecycle(me);
  }
}
