import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../config';

/** BullMQ queues by name, sharing one Redis config. Workers live in src/worker.ts. */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly queues = new Map<string, Queue>();
  private redisClient?: Redis;
  readonly connection: ConnectionOptions;

  private readonly redisUrl: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.redisUrl = config.REDIS_URL;
    const url = new URL(config.REDIS_URL);
    this.connection = {
      host: url.hostname,
      port: Number(url.port || 6379),
      password: url.password || undefined,
      db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
      maxRetriesPerRequest: null,
    };
  }

  queue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection });
      this.queues.set(name, q);
    }
    return q;
  }

  /** Shared Redis client for caches, OTPs and rate limits. */
  redis(): Redis {
    this.redisClient ??= new Redis(this.redisUrl, { maxRetriesPerRequest: 2 });
    return this.redisClient;
  }

  async onModuleDestroy() {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.redisClient?.disconnect();
  }
}
