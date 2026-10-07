import { Module } from '@nestjs/common';
import { PatientsModule } from '../patients/patients.module';
import { NotificationsController } from './notifications.controller';
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
  imports: [PatientsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsRepository, NotificationsDispatcher, ProvidersService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
