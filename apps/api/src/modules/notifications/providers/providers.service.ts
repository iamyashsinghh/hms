import { Injectable, Logger } from '@nestjs/common';
import { loadNotifyConfig, type NotifyConfig } from '../notifications.config';
import { ConsoleProvider } from './console.provider';
import { ExpoPushProvider } from './expo.provider';
import { GupshupWhatsappProvider } from './gupshup.provider';
import { Msg91SmsProvider } from './msg91.provider';
import type { Channel, MessageProvider } from './provider';
import { SesEmailProvider } from './ses.provider';

/** Picks one provider per channel from NOTIFY_*_PROVIDER. Falls back to console when keys are missing. */
@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);
  private readonly providers = new Map<Channel, MessageProvider>();
  readonly config: NotifyConfig = loadNotifyConfig();

  constructor() {
    const c = this.config;
    this.providers.set('sms', c.NOTIFY_SMS_PROVIDER === 'msg91' && c.MSG91_AUTH_KEY ? new Msg91SmsProvider(c.MSG91_AUTH_KEY) : this.fallback('sms', c.NOTIFY_SMS_PROVIDER));
    this.providers.set(
      'whatsapp',
      c.NOTIFY_WHATSAPP_PROVIDER === 'gupshup' && c.GUPSHUP_API_KEY && c.GUPSHUP_SOURCE
        ? new GupshupWhatsappProvider(c.GUPSHUP_API_KEY, c.GUPSHUP_SOURCE, c.GUPSHUP_APP_NAME ?? 'hms')
        : this.fallback('whatsapp', c.NOTIFY_WHATSAPP_PROVIDER),
    );
    this.providers.set(
      'email',
      c.NOTIFY_EMAIL_PROVIDER === 'ses' && c.AWS_ACCESS_KEY_ID && c.AWS_SECRET_ACCESS_KEY && c.SES_FROM_EMAIL
        ? new SesEmailProvider({ region: c.AWS_REGION, accessKeyId: c.AWS_ACCESS_KEY_ID, secretAccessKey: c.AWS_SECRET_ACCESS_KEY, fromEmail: c.SES_FROM_EMAIL })
        : this.fallback('email', c.NOTIFY_EMAIL_PROVIDER),
    );
    this.providers.set('push', c.NOTIFY_PUSH_PROVIDER === 'expo' ? new ExpoPushProvider(c.EXPO_ACCESS_TOKEN) : new ConsoleProvider('push'));
  }

  private fallback(channel: Channel, wanted: string): MessageProvider {
    if (wanted !== 'console') this.logger.warn(`${channel}: ${wanted} is missing credentials, using the console provider`);
    return new ConsoleProvider(channel);
  }

  get(channel: Channel): MessageProvider {
    return this.providers.get(channel)!;
  }

  /** Swap a provider (tests). */
  use(provider: MessageProvider): void {
    this.providers.set(provider.channel, provider);
  }
}
