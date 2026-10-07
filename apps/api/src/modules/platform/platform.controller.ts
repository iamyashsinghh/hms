import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import {
  cancelSubscriptionSchema,
  changePlanSchema,
  createTicketSchema,
  helpQuerySchema,
  onboardingStepKeySchema,
  payInvoiceSchema,
  signupSchema,
  ticketListQuerySchema,
  ticketReplySchema,
  type Announcement,
  type CodeAvailability,
  type Entitlements,
  type HelpArticle,
  type OnboardingChecklist,
  type OnboardingStepKey,
  type Paginated,
  type Plan,
  type SignupResult,
  type SubscriptionInvoice,
  type SubscriptionOverview,
  type Ticket,
  type TicketDetail,
} from './contracts';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { Ctx, Public, RequirePermissions } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/context/request-context';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { ContentService } from './content.service';
import { EntitlementsService } from './entitlements.service';
import { SignupService } from './signup.service';
import { SubscriptionsService } from './subscriptions.service';
import { TicketsService } from './tickets.service';

/** Public signup and the hospital-facing side of the platform (plan, tickets, help, onboarding). */
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly signup: SignupService,
    private readonly subs: SubscriptionsService,
    private readonly ent: EntitlementsService,
    private readonly tickets: TicketsService,
    private readonly content: ContentService,
  ) {}

  // ---------- public ----------

  @Public()
  @Get('plans')
  plans(): Promise<Plan[]> {
    return this.subs.listPlans();
  }

  @Public()
  @Get('signup/code-availability')
  codeAvailability(@Query('code') code: string, @Req() req: FastifyRequest): Promise<CodeAvailability> {
    this.signup.limiter.hit(`check:${req.ip}`);
    return this.signup.codeAvailability(code ?? '');
  }

  @Public()
  @Post('signup')
  async signupHospital(@Body(new ZodPipe(signupSchema)) body: z.output<typeof signupSchema>, @Req() req: FastifyRequest): Promise<SignupResult> {
    this.signup.limiter.hit(`signup:${req.ip}`);
    const { adminUserId: _id, ...result } = await this.signup.create({ ...body, source: 'self_signup', ip: req.ip });
    return result;
  }

  // ---------- plan and subscription ----------

  /** Every signed-in user can read what the hospital is entitled to (used to hide screens). */
  @Get('entitlements')
  @RequirePermissions('platform.help.read')
  entitlements(@Ctx() ctx: RequestContext): Promise<Entitlements> {
    return this.ent.forTenant(ctx.tenantId!);
  }

  @Get('subscription')
  @RequirePermissions('platform.subscription.read')
  subscription(): Promise<SubscriptionOverview> {
    return this.subs.overview();
  }

  @Post('subscription/change')
  @HttpCode(200)
  @RequirePermissions('platform.subscription.manage')
  changePlan(@Body(new ZodPipe(changePlanSchema)) body: z.output<typeof changePlanSchema>): Promise<SubscriptionOverview> {
    return this.subs.changePlan(body.planCode, body.billingCycle);
  }

  @Post('subscription/checkout')
  @HttpCode(200)
  @RequirePermissions('platform.subscription.manage')
  checkout(): Promise<SubscriptionInvoice> {
    return this.subs.checkout();
  }

  @Post('subscription/invoices/:id/pay')
  @HttpCode(200)
  @RequirePermissions('platform.subscription.manage')
  pay(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(payInvoiceSchema)) _body: z.output<typeof payInvoiceSchema>): Promise<SubscriptionOverview> {
    return this.subs.payInvoice(id);
  }

  @Post('subscription/cancel')
  @HttpCode(200)
  @RequirePermissions('platform.subscription.manage')
  cancel(@Body(new ZodPipe(cancelSubscriptionSchema)) body: z.output<typeof cancelSubscriptionSchema>): Promise<SubscriptionOverview> {
    return this.subs.setCancelAtPeriodEnd(body.cancel);
  }

  // ---------- announcements and help ----------

  @Get('announcements')
  @RequirePermissions('platform.help.read')
  announcements(): Promise<Announcement[]> {
    return this.content.announcements();
  }

  @Post('announcements/:id/dismiss')
  @HttpCode(204)
  @RequirePermissions('platform.help.read')
  dismiss(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.content.dismiss(id);
  }

  @Get('help')
  @RequirePermissions('platform.help.read')
  help(@Query(new ZodPipe(helpQuerySchema)) q: z.output<typeof helpQuerySchema>): Promise<HelpArticle[]> {
    return this.content.help(q.q, q.module);
  }

  @Get('help/:slug')
  @RequirePermissions('platform.help.read')
  helpArticle(@Param('slug') slug: string): Promise<HelpArticle> {
    return this.content.helpArticle(slug);
  }

  // ---------- onboarding ----------

  @Get('onboarding')
  @RequirePermissions('platform.onboarding.manage')
  onboarding(): Promise<OnboardingChecklist> {
    return this.content.onboarding();
  }

  @Post('onboarding/:step')
  @HttpCode(200)
  @RequirePermissions('platform.onboarding.manage')
  completeStep(@Param('step', new ZodPipe(onboardingStepKeySchema)) step: OnboardingStepKey): Promise<OnboardingChecklist> {
    return this.content.setStep(step, true);
  }

  @Delete('onboarding/:step')
  @RequirePermissions('platform.onboarding.manage')
  uncompleteStep(@Param('step', new ZodPipe(onboardingStepKeySchema)) step: OnboardingStepKey): Promise<OnboardingChecklist> {
    return this.content.setStep(step, false);
  }

  // ---------- support tickets ----------

  @Get('tickets')
  @RequirePermissions('platform.ticket.create')
  listTickets(@Query(new ZodPipe(ticketListQuerySchema)) q: z.output<typeof ticketListQuerySchema>): Promise<Paginated<Ticket>> {
    return this.tickets.list(q.status, q.page, q.pageSize);
  }

  @Post('tickets')
  @RequirePermissions('platform.ticket.create')
  createTicket(@Body(new ZodPipe(createTicketSchema)) body: z.output<typeof createTicketSchema>): Promise<TicketDetail> {
    return this.tickets.create(body);
  }

  @Get('tickets/:id')
  @RequirePermissions('platform.ticket.create')
  getTicket(@Param('id', ParseUUIDPipe) id: string): Promise<TicketDetail> {
    return this.tickets.get(id);
  }

  @Post('tickets/:id/messages')
  @RequirePermissions('platform.ticket.create')
  replyTicket(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ticketReplySchema)) body: z.output<typeof ticketReplySchema>): Promise<TicketDetail> {
    return this.tickets.reply(id, body.body);
  }

  @Post('tickets/:id/resolve')
  @HttpCode(200)
  @RequirePermissions('platform.ticket.create')
  resolveTicket(@Param('id', ParseUUIDPipe) id: string): Promise<TicketDetail> {
    return this.tickets.resolve(id);
  }
}
