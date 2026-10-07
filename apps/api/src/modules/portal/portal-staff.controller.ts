import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { portal } from '@hms/shared';
import type { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { RequireEntitlement } from '../platform';
import { PortalService } from './portal.service';

/** Hospital staff side of the portal: online booking requests and patient feedback. */
@RequireEntitlement('portal')
@Controller('portal/staff')
export class PortalStaffController {
  constructor(private readonly portal: PortalService) {}

  @Get('bookings')
  @RequirePermissions('portal.booking.read')
  bookings(@Query(new ZodPipe(portal.staffBookingQuerySchema)) q: z.output<typeof portal.staffBookingQuerySchema>) {
    return this.portal.staffBookings(q);
  }

  @Post('bookings/:id/decision')
  @HttpCode(200)
  @RequirePermissions('portal.booking.manage')
  decide(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(portal.decideBookingSchema)) body: portal.DecideBooking) {
    return this.portal.decide(id, body);
  }

  @Get('feedback')
  @RequirePermissions('portal.feedback.read')
  feedback(@Query(new ZodPipe(portal.staffFeedbackQuerySchema)) q: z.output<typeof portal.staffFeedbackQuerySchema>) {
    return this.portal.staffFeedback(q);
  }
}
