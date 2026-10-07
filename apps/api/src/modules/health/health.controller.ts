import { Controller, Get } from '@nestjs/common';
import { sql } from '@hms/db';
import { Public } from '../../common/auth/decorators';
import { DbService } from '../../common/db/db.service';
import { QueueService } from '../../common/queue/queue.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DbService,
    private readonly queues: QueueService,
  ) {}

  @Public()
  @Get()
  async health() {
    const started = Date.now();
    await this.db.db.execute(sql`select 1`);
    const redis = await this.queues.redis().ping();
    return { status: 'ok', db: 'ok', redis: redis === 'PONG' ? 'ok' : redis, ms: Date.now() - started };
  }
}
