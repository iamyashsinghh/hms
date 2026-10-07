import { Injectable, Logger } from '@nestjs/common';

export interface EventEnvelope<P = Record<string, unknown>> {
  id: string;
  tenantId: string;
  topic: string;
  payload: P;
  createdAt: string;
}

export type EventHandler<P = Record<string, unknown>> = (event: EventEnvelope<P>) => Promise<void>;

/**
 * Registry of outbox event handlers. Modules register in onModuleInit:
 *   constructor(private bus: EventBus) {}
 *   onModuleInit() { this.bus.on('billing.invoice.finalized', (e) => this.handle(e)); }
 * Handlers run in the worker process (pnpm --filter @hms/api worker), at least once, so make them idempotent.
 */
@Injectable()
export class EventBus {
  private readonly logger = new Logger(EventBus.name);
  private readonly handlers = new Map<string, EventHandler[]>();

  on<P = Record<string, unknown>>(topic: string, handler: EventHandler<P>): void {
    const list = this.handlers.get(topic) ?? [];
    list.push(handler as EventHandler);
    this.handlers.set(topic, list);
  }

  async dispatch(event: EventEnvelope): Promise<void> {
    const list = this.handlers.get(event.topic) ?? [];
    if (!list.length) this.logger.debug(`no handler for ${event.topic}`);
    for (const h of list) await h(event);
  }
}
