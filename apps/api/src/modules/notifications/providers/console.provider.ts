import { Logger } from '@nestjs/common';
import type { Channel, MessageProvider, OutboundMessage, SendOutcome } from './provider';

/** Development provider: logs the message and keeps the last few in memory. Sends nothing. */
export class ConsoleProvider implements MessageProvider {
  static readonly outbox: OutboundMessage[] = [];
  private readonly logger = new Logger('ConsoleProvider');
  readonly name = 'console';

  constructor(readonly channel: Channel) {}

  async send(message: OutboundMessage): Promise<SendOutcome> {
    ConsoleProvider.outbox.push(message);
    if (ConsoleProvider.outbox.length > 200) ConsoleProvider.outbox.shift();
    this.logger.log(`[${this.channel}] to ${message.to}: ${message.subject ? `${message.subject} | ` : ''}${message.body}`);
    return { providerMessageId: `console-${message.id}`, status: 'delivered' };
  }
}
