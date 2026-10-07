import { Global, Module } from '@nestjs/common';
import { EventBus } from '../events/event-bus';
import { QueueService } from './queue.service';

@Global()
@Module({ providers: [QueueService, EventBus], exports: [QueueService, EventBus] })
export class QueueModule {}
