import { Injectable } from '@nestjs/common';
import { recordViews, type Tx } from '@hms/db';
import { currentContext } from '../context/request-context';

/**
 * Data changes are audited by database triggers (app.enable_audit). Reads of sensitive
 * records are logged here, e.g. opening a patient's chart.
 */
@Injectable()
export class AuditService {
  async recordView(tx: Tx, entity: string, recordId: string, reason?: string): Promise<void> {
    const ctx = currentContext();
    if (!ctx?.tenantId || !ctx.userId) return;
    await tx.insert(recordViews).values({ tenantId: ctx.tenantId, entity, recordId, actorId: ctx.userId, reason });
  }
}
