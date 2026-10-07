import { Injectable, Logger } from '@nestjs/common';

/** Delivers a login code by SMS/WhatsApp. Swap in NotificationsService once the notifications module lands. */
export interface OtpSender {
  /** True when the code is not really delivered, so the API may echo it back outside production. */
  readonly isMock: boolean;
  send(input: { tenantId: string; mobile: string; code: string; hospitalName: string }): Promise<void>;
}

export const OTP_SENDER = Symbol('OTP_SENDER');

/** Mock provider: logs the code (masked mobile) and sends nothing to external services. */
@Injectable()
export class ConsoleOtpSender implements OtpSender {
  readonly isMock = true;
  private readonly logger = new Logger('PortalOtp');

  async send(input: { mobile: string; code: string; hospitalName: string }): Promise<void> {
    this.logger.log(`OTP for ******${input.mobile.slice(-4)} at ${input.hospitalName}: ${input.code}`);
  }
}
