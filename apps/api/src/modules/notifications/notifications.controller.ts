import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { notifications as n, type Paginated } from '@hms/shared';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { RequireEntitlement } from '../platform';
import { NotificationsService } from './notifications.service';

const channelSchema = z.enum(n.CHANNELS);
const templateKeySchema = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);

/** Everything except push tokens needs the 'notifications' module in the hospital's plan. */
@Controller('notifications')
@RequireEntitlement('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  // ---------- messages ----------

  @Get('messages')
  @RequirePermissions('notifications.message.read')
  listMessages(@Query(new ZodPipe(n.messageQuerySchema)) q: z.output<typeof n.messageQuerySchema>): Promise<Paginated<n.Message>> {
    return this.svc.listMessages(q);
  }

  @Get('messages/stats')
  @RequirePermissions('notifications.message.read')
  stats(): Promise<n.MessageStats> {
    return this.svc.stats();
  }

  @Get('messages/:id')
  @RequirePermissions('notifications.message.read')
  getMessage(@Param('id', ParseUUIDPipe) id: string): Promise<n.Message> {
    return this.svc.getMessage(id);
  }

  @Post('messages')
  @RequirePermissions('notifications.message.send')
  send(@Body(new ZodPipe(n.sendRequestSchema)) body: n.SendRequest): Promise<n.SendResult> {
    return this.svc.sendManual(body);
  }

  @Post('messages/:id/retry')
  @HttpCode(200)
  @RequirePermissions('notifications.message.send')
  retry(@Param('id', ParseUUIDPipe) id: string): Promise<n.Message> {
    return this.svc.retry(id);
  }

  // ---------- templates ----------

  @Get('templates')
  @RequirePermissions('notifications.template.read')
  listTemplates(): Promise<n.Template[]> {
    return this.svc.listTemplates();
  }

  @Post('templates/preview')
  @HttpCode(200)
  @RequirePermissions('notifications.template.read')
  preview(@Body(new ZodPipe(n.previewTemplateSchema)) body: n.PreviewTemplate): Promise<n.TemplatePreview> {
    return this.svc.previewTemplate(body);
  }

  @Put('templates/:key/:channel')
  @RequirePermissions('notifications.template.manage')
  upsertTemplate(
    @Param('key', new ZodPipe(templateKeySchema)) key: string,
    @Param('channel', new ZodPipe(channelSchema)) channel: n.Channel,
    @Body(new ZodPipe(n.upsertTemplateSchema)) body: n.UpsertTemplate,
  ): Promise<n.Template> {
    return this.svc.upsertTemplate(key, channel, body);
  }

  @Delete('templates/:key/:channel')
  @HttpCode(204)
  @RequirePermissions('notifications.template.manage')
  resetTemplate(@Param('key', new ZodPipe(templateKeySchema)) key: string, @Param('channel', new ZodPipe(channelSchema)) channel: n.Channel): Promise<void> {
    return this.svc.resetTemplate(key, channel);
  }

  // ---------- rules ----------

  @Get('rules')
  @RequirePermissions('notifications.template.read')
  listRules(): Promise<n.Rule[]> {
    return this.svc.listRules();
  }

  @Put('rules')
  @RequirePermissions('notifications.template.manage')
  updateRule(@Body(new ZodPipe(n.updateRuleSchema)) body: n.UpdateRule): Promise<n.Rule> {
    return this.svc.updateRule(body);
  }

  // ---------- opt-outs ----------

  @Get('opt-outs')
  @RequirePermissions('notifications.optout.manage')
  listOptOuts(@Query(new ZodPipe(n.optOutQuerySchema)) q: z.output<typeof n.optOutQuerySchema>): Promise<Paginated<n.OptOut>> {
    return this.svc.listOptOuts(q.q, q.page, q.pageSize);
  }

  @Post('opt-outs')
  @RequirePermissions('notifications.optout.manage')
  addOptOut(@Body(new ZodPipe(n.createOptOutSchema)) body: n.CreateOptOut): Promise<n.OptOut> {
    return this.svc.addOptOut(body);
  }

  @Delete('opt-outs/:id')
  @HttpCode(204)
  @RequirePermissions('notifications.optout.manage')
  removeOptOut(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.svc.removeOptOut(id);
  }

  // ---------- credits ----------

  @Get('credits')
  @RequirePermissions('notifications.credit.read')
  credits(): Promise<n.CreditSummary> {
    return this.svc.credits();
  }

  @Get('credits/ledger')
  @RequirePermissions('notifications.credit.read')
  ledger(@Query(new ZodPipe(n.ledgerQuerySchema)) q: z.output<typeof n.ledgerQuerySchema>): Promise<Paginated<n.LedgerEntry>> {
    return this.svc.ledger(q.page, q.pageSize);
  }

  @Post('credits/topup')
  @HttpCode(200)
  @RequirePermissions('notifications.credit.topup')
  topup(@Body(new ZodPipe(n.topupSchema)) body: n.Topup): Promise<n.CreditSummary> {
    return this.svc.topup(body);
  }

  // ---------- settings ----------

  @Get('settings')
  @RequirePermissions('notifications.settings.manage')
  getSettings(): Promise<n.Settings> {
    return this.svc.getSettings();
  }

  @Put('settings')
  @RequirePermissions('notifications.settings.manage')
  updateSettings(@Body(new ZodPipe(n.updateSettingsSchema)) body: n.UpdateSettings): Promise<n.Settings> {
    return this.svc.updateSettings(body);
  }
}

/** Push token registration stays open on every plan: the mobile apps call it after login. */
@Controller('notifications/devices')
export class NotificationsDevicesController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  @RequirePermissions('notifications.device.register')
  myDevices(): Promise<n.Device[]> {
    return this.svc.myDevices();
  }

  @Post()
  @RequirePermissions('notifications.device.register')
  registerDevice(@Body(new ZodPipe(n.registerDeviceSchema)) body: n.RegisterDevice): Promise<n.Device> {
    return this.svc.registerDevice(body);
  }

  @Post('unregister')
  @HttpCode(204)
  @RequirePermissions('notifications.device.register')
  unregisterDevice(@Body(new ZodPipe(n.unregisterDeviceSchema)) body: { token: string }): Promise<void> {
    return this.svc.unregisterDevice(body.token);
  }
}
