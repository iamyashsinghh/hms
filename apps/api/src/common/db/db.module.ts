import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from '../../config';
import { DbService } from './db.service';
import { OutboxService } from '../events/outbox.service';
import { AuditService } from './audit.service';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }, DbService, OutboxService, AuditService],
  exports: [APP_CONFIG, DbService, OutboxService, AuditService],
})
export class CoreInfraModule {}
