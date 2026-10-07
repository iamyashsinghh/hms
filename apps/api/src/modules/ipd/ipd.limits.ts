import { Injectable } from '@nestjs/common';
import type { Tx } from '@hms/db';
import { PlatformService } from '../platform';

/** Plan limits for IPD: the hospital's plan caps active beds (403 plan_limit_reached). */
@Injectable()
export class IpdPlanLimits {
  constructor(private readonly platform: PlatformService) {}

  assertBeds(_tx: Tx, adding: number, current: number): Promise<void> {
    return this.platform.assertWithinLimit('beds', { adding, current });
  }
}
