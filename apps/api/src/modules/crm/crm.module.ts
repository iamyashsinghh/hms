import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PatientsModule } from '../patients/patients.module';
import { CampsService } from './camps.service';
import { CrmController } from './crm.controller';
import { CrmEventsService } from './crm-events.service';
import { CrmMessenger } from './crm.messenger';
import { CrmDashboardService } from './dashboard.service';
import { FollowUpsService } from './followups.service';
import { LeadsService } from './leads.service';
import { ReferralsService } from './referrals.service';

/**
 * Referral & CRM. Owned by the "crm" workstream (see PARALLEL_PLAN.md).
 * Enquiries (leads), referrers + commission rules/statements, health camps, message campaigns and
 * patient follow-up reminders. Permissions and Zod contracts live in packages/shared/src/modules/crm.ts.
 * Messages go out only through NotificationsService (CrmMessenger). Commissions accrue from billing events.
 */
@Module({
  imports: [PatientsModule, NotificationsModule],
  controllers: [CrmController],
  providers: [LeadsService, ReferralsService, CampsService, FollowUpsService, CrmDashboardService, CrmEventsService, CrmMessenger],
  exports: [ReferralsService, FollowUpsService],
})
export class CrmModule {}
