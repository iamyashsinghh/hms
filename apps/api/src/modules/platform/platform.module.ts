import { Global, Module } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { PlatformAdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ContentService } from './content.service';
import { EntitlementGuard } from './entitlement.guard';
import { EntitlementsService } from './entitlements.service';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformController } from './platform.controller';
import { PlatformDb } from './platform-db';
import { PlatformService } from './platform.service';
import { SignupService } from './signup.service';
import { SubscriptionsService } from './subscriptions.service';
import { TicketsService } from './tickets.service';

/**
 * SaaS Platform (see PARALLEL_PLAN.md, W6). Global so any module can use
 *   @RequireEntitlement('<moduleKey>')   (from './modules/platform')
 * and inject PlatformService without importing this module.
 */
@Global()
@Module({
  controllers: [PlatformController, PlatformAdminController],
  providers: [
    PlatformDb,
    EntitlementsService,
    EntitlementGuard,
    SubscriptionsService,
    SignupService,
    TicketsService,
    ContentService,
    AdminAuthService,
    PlatformAdminGuard,
    AdminService,
    PlatformService,
  ],
  exports: [PlatformService, EntitlementsService, EntitlementGuard],
})
export class PlatformModule {}
