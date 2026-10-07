import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { setup as S } from '@hms/shared';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { ProfileService } from './profile.service';

const templateKey = new ZodPipe(z.enum(S.PRINT_TEMPLATE_KEYS));
const facilityQuery = new ZodPipe(z.object({ facilityId: z.uuid().optional() }));

@Controller('setup')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get('profile')
  @RequirePermissions('setup.profile.read')
  getProfile(): Promise<S.HospitalProfile> {
    return this.profile.getProfile();
  }

  @Put('profile')
  @RequirePermissions('setup.profile.manage')
  upsertProfile(@Body(new ZodPipe(S.upsertProfileSchema)) body: S.UpsertProfile): Promise<S.HospitalProfile> {
    return this.profile.upsertProfile(body);
  }

  @Get('wizard')
  @RequirePermissions('setup.profile.read')
  wizard(): Promise<S.WizardStatus> {
    return this.profile.wizardStatus();
  }

  @Post('wizard/complete')
  @RequirePermissions('setup.profile.manage')
  completeWizard(): Promise<S.WizardStatus> {
    return this.profile.completeWizard();
  }

  @Get('number-series')
  @RequirePermissions('setup.series.manage')
  listSeries(): Promise<S.NumberSeries[]> {
    return this.profile.listNumberSeries();
  }

  @Put('number-series/:key')
  @RequirePermissions('setup.series.manage')
  updateSeries(@Param('key') key: string, @Body(new ZodPipe(S.updateNumberSeriesSchema)) body: S.UpdateNumberSeries): Promise<S.NumberSeries> {
    return this.profile.updateNumberSeries(key, body);
  }

  @Get('print-templates')
  @RequirePermissions('setup.template.read')
  listTemplates(@Query(facilityQuery) q: { facilityId?: string }): Promise<S.PrintTemplate[]> {
    return this.profile.listPrintTemplates(q.facilityId);
  }

  @Get('print-templates/:key')
  @RequirePermissions('setup.template.read')
  getTemplate(@Param('key', templateKey) key: S.PrintTemplateKey, @Query(facilityQuery) q: { facilityId?: string }): Promise<S.PrintTemplate> {
    return this.profile.getPrintTemplate(key, q.facilityId);
  }

  @Put('print-templates/:key')
  @RequirePermissions('setup.template.manage')
  upsertTemplate(
    @Param('key', templateKey) key: S.PrintTemplateKey,
    @Body(new ZodPipe(S.upsertPrintTemplateSchema)) body: S.UpsertPrintTemplate,
  ): Promise<S.PrintTemplate> {
    return this.profile.upsertPrintTemplate(key, body);
  }
}
