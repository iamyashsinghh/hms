import { Module } from '@nestjs/common';
import { PatientsModule } from '../patients/patients.module';
import { ReportsModule } from '../reports/reports.module';
import { NotificationsController, NotificationsDevicesController } from './notifications.controller';
import { NotificationsScheduler } from './notifications.scheduler';
import { NotificationsDispatcher } from './notifications.dispatcher';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { ProvidersService } from './providers/providers.service';

/**
 * Notifications: SMS / WhatsApp / email / push behind one provider interface, templates,
 * event rules, delivery log, opt-outs and the prepaid credit wallet.
 * Other modules import NotificationsModule and call NotificationsService.send(tx, {...}).
 */
@Module({
  imports: [PatientsModule, ReportsModule],
  controllers: [NotificationsController, NotificationsDevicesController],
  providers: [NotificationsService, NotificationsRepository, NotificationsDispatcher, NotificationsScheduler, ProvidersService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
