import { Module } from '@nestjs/common';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { OrgController } from './org.controller';
import { OrgService } from './org.service';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { SetupService } from './setup.service';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

/**
 * Hospital Setup: profile/letterhead, wizard, facilities, departments, staff profiles, doctor schedules,
 * users and roles, number series, print templates. Other modules import SetupModule and use SetupService.
 */
@Module({
  controllers: [ProfileController, OrgController, StaffController, AccessController],
  providers: [ProfileService, OrgService, StaffService, AccessService, SetupService],
  exports: [SetupService],
})
export class SetupModule {}
