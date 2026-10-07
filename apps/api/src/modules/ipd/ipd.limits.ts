import { Injectable } from '@nestjs/common';
import type { Tx } from '@hms/db';

/**
 * Plan limits for IPD (bed count). Delegates to PlatformService.assertWithinLimit('beds') once the
 * platform module is on main; until then there is no limit to enforce.
 */
@Injectable()
export class IpdPlanLimits {
  async assertBeds(_tx: Tx, _adding: number, _current: number): Promise<void> {}
}
