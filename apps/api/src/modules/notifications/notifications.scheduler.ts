import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Worker } from 'bullmq';
import { inArray, tenants } from '@hms/db';
import { notifications as n } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { QueueService } from '../../common/queue/queue.service';
import { PlatformService } from '../platform';
import { ReportsService } from '../reports/reports.service';
import { NotificationsDispatcher } from './notifications.dispatcher';
import { formatAmount, formatDateIST } from './render';

const QUEUE = 'notifications-scheduler';

/** Scheduled jobs run only in the worker process (`node dist/worker.js`); NOTIFY_SCHEDULER=off disables them. */
const isWorkerProcess = () => process.env.NOTIFY_SCHEDULER !== 'off' && /worker\.(js|ts)$/.test(process.argv[1] ?? '');

/** The day before `now` in IST, as YYYY-MM-DD. */
export function yesterdayIST(now = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000 - 86_400_000);
  return ist.toISOString().slice(0, 10);
}

/**
 * Timed messages. Every day at 07:00 IST each hospital's owners get yesterday's summary
 * from ReportsService (the "Owner daily summary" rule picks channels).
 */
@Injectable()
export class NotificationsScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsScheduler.name);
  private worker?: Worker;

  constructor(
    private readonly db: DbService,
    private readonly queues: QueueService,
    private readonly reports: ReportsService,
    private readonly platform: PlatformService,
    private readonly dispatcher: NotificationsDispatcher,
  ) {}

  async onApplicationBootstrap() {
    if (!isWorkerProcess()) return;
    const queue = this.queues.queue(QUEUE);
    await queue.upsertJobScheduler('owner-summary', { pattern: '0 7 * * *', tz: 'Asia/Kolkata' }, { name: 'owner-summary' });
    this.worker = new Worker(
      QUEUE,
      async (job) => {
        if (job.name === 'owner-summary') await this.runOwnerSummaries();
      },
      { connection: this.queues.connection },
    );
    this.worker.on('failed', (job, err) => this.logger.error(`${job?.name} failed: ${err.message}`));
    this.logger.log('owner summary scheduled for 07:00 IST');
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  /** Sends yesterday's summary for every live hospital. One hospital's failure does not stop the rest. */
  async runOwnerSummaries(date = yesterdayIST()): Promise<void> {
    const live = await this.db.db.select({ id: tenants.id }).from(tenants).where(inArray(tenants.status, ['active', 'trial', 'grace']));
    for (const t of live) {
      try {
        await this.sendOwnerSummary(t.id, date);
      } catch (e) {
        this.logger.error(`owner summary for ${t.id}: ${(e as Error).message}`);
      }
    }
  }

  async sendOwnerSummary(tenantId: string, date: string): Promise<void> {
    if (!(await this.platform.hasModule(tenantId, 'notifications'))) return;
    const s = await this.reports.ownerSummaryForTenant(tenantId, date);
    await this.dispatcher.onDomainEvent({
      id: `owner-summary:${date}`,
      tenantId,
      topic: n.OWNER_SUMMARY_TOPIC,
      createdAt: new Date().toISOString(),
      payload: {
        summaryDate: formatDateIST(new Date(`${s.date}T12:00:00+05:30`)),
        opdVisits: s.opdVisits,
        newPatients: s.newPatients,
        billed: formatAmount(s.billed),
        collections: formatAmount(s.collections),
        pendingCount: s.pendingBills.count,
        pendingAmount: formatAmount(s.pendingBills.amount),
        refId: s.date,
      },
    });
  }
}
