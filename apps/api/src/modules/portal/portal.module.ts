import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { FrontofficeModule } from '../frontoffice/frontoffice.module';
import { PatientsModule } from '../patients/patients.module';
import { SetupModule } from '../setup/setup.module';
import { ConsoleOtpSender, OTP_SENDER } from './otp.sender';
import { PatientAuthGuard } from './portal-auth.guard';
import { PortalAuthController } from './portal-auth.controller';
import { PortalAuthService } from './portal-auth.service';
import { PortalController } from './portal.controller';
import { PortalEventsService } from './portal-events.service';
import { PortalGateway } from './portal.gateway';
import { PortalPatientsService } from './portal-patients.service';
import { PortalRepository } from './portal.repository';
import { PortalService } from './portal.service';
import { PortalStaffController } from './portal-staff.controller';

/**
 * Patient Portal. Owned by the "portal" workstream (see PARALLEL_PLAN.md).
 * Patients sign in with mobile + OTP (typ 'patient' tokens, PatientAuthGuard); staff routes live under
 * /portal/staff with normal permissions. Prescriptions, bills, reports and desk appointments are read
 * models fed by other modules' events (PortalEventsService). Doctors/timetables (setup) and bookings (front office) go through PortalGateway.
 */
@Module({
  imports: [PatientsModule, SetupModule, FrontofficeModule, BillingModule],
  controllers: [PortalAuthController, PortalStaffController, PortalController],
  providers: [
    PortalRepository,
    PortalAuthService,
    PortalPatientsService,
    PortalService,
    PortalGateway,
    PortalEventsService,
    PatientAuthGuard,
    { provide: OTP_SENDER, useClass: ConsoleOtpSender },
  ],
})
export class PortalModule {}
