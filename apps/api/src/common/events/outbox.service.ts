import { Injectable } from '@nestjs/common';
import { outbox, type Tx } from '@hms/db';
import { currentContext } from '../context/request-context';

/**
 * Transactional outbox. Publish inside the same tx as the change; the worker delivers it to
 * handlers registered with EventBus.on(). Topic names: `<module>.<entity>.<event>`, e.g. `billing.invoice.finalized`.
 */
@Injectable()
export class OutboxService {
  async publish(tx: Tx, topic: string, payload: Record<string, unknown>, tenantId?: string): Promise<void> {
    const tid = tenantId ?? currentContext()?.tenantId;
    if (!tid) throw new Error('OutboxService.publish needs a tenant');
    await tx.insert(outbox).values({ tenantId: tid, topic, payload });
  }
}
