import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { sql } from '@hms/db';
import { AppModule } from './app.module';
import { DbService } from './common/db/db.service';
import { EventBus, type EventEnvelope } from './common/events/event-bus';
import { QueueService } from './common/queue/queue.service';

const EVENTS_QUEUE = 'events';
const POLL_MS = 1000;

/**
 * Background worker: relays outbox rows to BullMQ and runs the handlers modules registered
 * on EventBus. Run with `pnpm --filter @hms/api worker` (after build).
 */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  const logger = new Logger('Worker');
  const db = app.get(DbService);
  const queues = app.get(QueueService);
  const bus = app.get(EventBus);
  const events = queues.queue(EVENTS_QUEUE);

  const worker = new Worker<EventEnvelope>(EVENTS_QUEUE, (job) => bus.dispatch(job.data), {
    connection: queues.connection,
    concurrency: 10,
  });
  worker.on('failed', (job, err) => logger.error(`event ${job?.name} failed: ${err.message}`));

  let stopping = false;
  const relay = async () => {
    while (!stopping) {
      let n = 0;
      try {
        n = await db.db.transaction(async (tx) => {
          const res = await tx.execute<{ id: string; tenant_id: string; topic: string; payload: Record<string, unknown>; created_at: string }>(
            sql`select * from audit.claim_outbox(100)`,
          );
          if (res.rows.length) {
            await events.addBulk(
              res.rows.map((r) => ({
                name: r.topic,
                data: { id: r.id, tenantId: r.tenant_id, topic: r.topic, payload: r.payload, createdAt: r.created_at },
                opts: { jobId: r.id, attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000 },
              })),
            );
          }
          return res.rows.length;
        });
      } catch (e) {
        logger.error(`outbox relay: ${(e as Error).message}`);
      }
      if (n === 0) await new Promise((r) => setTimeout(r, POLL_MS));
    }
  };
  const running = relay();
  logger.log('worker started');

  const shutdown = async () => {
    stopping = true;
    await running;
    await worker.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
