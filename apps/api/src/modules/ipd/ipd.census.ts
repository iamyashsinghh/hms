import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { sql, type Tx } from '@hms/db';
import type { ipd as I } from '@hms/shared';
import { APP_CONFIG, type AppConfig } from '../../config';
import { DbService } from '../../common/db/db.service';
import { OutboxService } from '../../common/events/outbox.service';
import { istDate } from './ipd.calc';
import { IpdRepository } from './ipd.repository';

const EVERY_MS = 60 * 60 * 1000;

/** Yesterday's date in India. */
const yesterdayIST = () => istDate(new Date(Date.now() - 86_400_000));

/**
 * Daily midnight census per ward (patient-days and device-days). The API checks every hour and
 * publishes `ipd.census.daily` for yesterday once per hospital and facility (claimed in
 * inpatient.census_runs, so several API instances never publish twice).
 */
@Injectable()
export class IpdCensusService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('IpdCensus');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: DbService,
    private readonly repo: IpdRepository,
    private readonly outbox: OutboxService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap() {
    if (this.config.NODE_ENV === 'test') return;
    const run = () => this.publishAll(yesterdayIST()).catch((e) => this.log.error(`census run failed: ${(e as Error).message}`));
    this.timer = setInterval(run, EVERY_MS);
    this.timer.unref();
    setTimeout(run, 20_000).unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Live census for one facility (today counts up to now). */
  wards(tx: Tx, facilityId: string, date: string): Promise<I.WardCensus[]> {
    return this.compute(tx, facilityId, date);
  }

  /** Publish the census for `date` in every active hospital that has not had it yet. */
  async publishAll(date: string): Promise<number> {
    const res = await this.db.db.execute<{ id: string }>(sql`select id from platform.tenants where status = 'active'`);
    let published = 0;
    for (const { id } of res.rows) {
      try {
        published += await this.publishForTenant(id, date);
      } catch (e) {
        this.log.error(`census for tenant ${id} on ${date} failed: ${(e as Error).message}`);
      }
    }
    return published;
  }

  /** Returns how many facilities were published (0 when already done). Only for dates that have ended. */
  publishForTenant(tenantId: string, date: string): Promise<number> {
    return this.db.asTenant({ tenantId }, async (tx) => {
      let n = 0;
      for (const facilityId of await this.repo.facilitiesWithWards(tx)) {
        const wards = await this.compute(tx, facilityId, date);
        const claimed = await this.repo.claimCensus(tx, {
          tenantId,
          facilityId,
          censusDate: date,
          wardCount: wards.length,
          patientDays: wards.reduce((s, w) => s + w.patientDays, 0),
        });
        if (!claimed) continue;
        const event: I.CensusDailyEvent = { facilityId, date, wards };
        await this.outbox.publish(tx, 'ipd.census.daily', { ...event }, tenantId);
        n++;
      }
      return n;
    });
  }

  private async compute(tx: Tx, facilityId: string, date: string): Promise<I.WardCensus[]> {
    const endOfDay = Date.parse(`${date}T23:59:59.999+05:30`);
    const cut = new Date(Math.min(endOfDay, Date.now())).toISOString();
    const rows = await this.repo.census(tx, facilityId, date, cut);
    return rows.map((r) => ({
      facilityId,
      date,
      wardId: r.ward_id,
      wardName: r.ward_name,
      wardType: r.ward_type as I.WardType,
      patientDays: r.patient_days,
      catheterDays: r.catheter_days,
      centralLineDays: r.central_line_days,
      ventilatorDays: r.ventilator_days,
      admissions: r.admissions,
      discharges: r.discharges,
      surgeries: null,
    }));
  }
}
