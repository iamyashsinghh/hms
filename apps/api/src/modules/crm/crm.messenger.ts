import { Injectable } from '@nestjs/common';
import type { Tx } from '@hms/db';
import { NotificationsService } from '../notifications/notifications.service';

export interface CrmMessage {
  to: { patientId?: string; mobile?: string; email?: string };
  /** Text for the hospital's `custom.message` template. */
  message: string;
  /** Shown as {{patientName}} when the recipient is not a registered patient. */
  name?: string;
  channels: ('sms' | 'whatsapp' | 'email')[];
  idempotencyKey: string;
  refId: string;
}

export interface CrmSendOutcome {
  queued: number;
  skipped: number;
  reason: string | null;
}

/**
 * CRM sends every message through NotificationsService (templates, opt-outs, credits, delivery log),
 * using the built-in `custom.message` template. Kept behind this class so tests can swap it.
 */
@Injectable()
export class CrmMessenger {
  constructor(private readonly notifications: NotificationsService) {}

  async send(tx: Tx, m: CrmMessage): Promise<CrmSendOutcome> {
    const res = await this.notifications.send(tx, {
      to: m.to,
      template: 'custom.message',
      data: { message: m.message, ...(m.name ? { patientName: m.name } : {}) },
      channels: m.channels,
      idempotencyKey: m.idempotencyKey,
      source: { module: 'crm', refId: m.refId },
    });
    const queued = res.messages.filter((x) => x.status !== 'skipped' && x.status !== 'failed').length;
    return { queued, skipped: res.messages.length - queued, reason: res.messages.find((x) => x.reason)?.reason ?? null };
  }
}
