import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { iso, type Tx } from '@hms/db';
import { integrations } from '@hms/shared';
import { currentContext } from '../../common/context/request-context';
import { DbService } from '../../common/db/db.service';
import { AppError } from '../../common/errors/errors';
import { MockAbdmGateway, SandboxAbdmGateway, type AbdmGateway } from './adapters/abdm.gateway';
import { MockPaymentGateway, RazorpayGateway, type PaymentGateway } from './adapters/payment.gateway';
import { INTEGRATIONS_CONFIG, type IntegrationsConfig } from './integrations.config';
import { IntegrationsRepository, type SettingsRow } from './integrations.repository';

type Settings = integrations.IntegrationSettings;

export interface EffectiveSettings {
  abdmMode: integrations.AbdmMode;
  hfrId: string | null;
  hipName: string | null;
  paymentProvider: integrations.PaymentProvider;
  paymentKeyId: string | null;
}

const DEFAULTS: EffectiveSettings = { abdmMode: 'disabled', hfrId: null, hipName: null, paymentProvider: 'none', paymentKeyId: null };

/** Hospital-level integration settings, and the adapters they select. */
@Injectable()
export class IntegrationSettingsService {
  readonly mockAbdm = new MockAbdmGateway();
  private readonly sandboxAbdm: SandboxAbdmGateway;
  readonly mockPayments: MockPaymentGateway;
  private readonly razorpay: RazorpayGateway;

  constructor(
    private readonly db: DbService,
    private readonly repo: IntegrationsRepository,
    @Inject(INTEGRATIONS_CONFIG) readonly config: IntegrationsConfig,
  ) {
    this.sandboxAbdm = new SandboxAbdmGateway(config.abdmSandbox);
    this.mockPayments = new MockPaymentGateway(config.mockPaymentWebhookSecret);
    this.razorpay = new RazorpayGateway(config.razorpay);
  }

  get(): Promise<Settings> {
    return this.db.tx(async (tx) => this.toDto(await this.repo.settings(tx)));
  }

  update(input: integrations.SettingsInput): Promise<Settings> {
    const d = integrations.settingsInputSchema.parse(input);
    const userId = currentContext()?.userId ?? null;
    return this.db.tx(async (tx) => {
      const row = await this.repo.upsertSettings(tx, {
        abdmMode: d.abdmMode,
        hfrId: d.hfrId || null,
        hipName: d.hipName || null,
        paymentProvider: d.paymentProvider,
        paymentKeyId: d.paymentKeyId || null,
        createdBy: userId,
        updatedBy: userId,
      });
      return this.toDto(row);
    });
  }

  async effective(tx: Tx): Promise<EffectiveSettings> {
    const row = await this.repo.settings(tx);
    return row ? (row as EffectiveSettings) : DEFAULTS;
  }

  /** The ABDM adapter for this hospital; fails when ABDM is switched off. */
  async abdm(tx: Tx): Promise<{ gateway: AbdmGateway; settings: EffectiveSettings }> {
    const settings = await this.effective(tx);
    if (settings.abdmMode === 'disabled') {
      throw new AppError(HttpStatus.CONFLICT, 'abdm_disabled', 'ABDM is switched off for this hospital. Turn it on in Integrations settings.');
    }
    return { gateway: this.abdmGateway(settings.abdmMode), settings };
  }

  abdmGateway(mode: integrations.AbdmMode): AbdmGateway {
    return mode === 'sandbox' ? this.sandboxAbdm : this.mockAbdm;
  }

  paymentGateway(provider: 'mock' | 'razorpay'): PaymentGateway {
    return provider === 'razorpay' ? this.razorpay : this.mockPayments;
  }

  private toDto(row: SettingsRow | undefined): Settings {
    const s = row ? (row as EffectiveSettings) : DEFAULTS;
    const tenantId = currentContext()?.tenantId ?? '';
    const base = `${this.config.publicApiUrl}/integrations/callbacks`;
    return {
      abdmMode: s.abdmMode,
      hfrId: s.hfrId,
      hipName: s.hipName,
      paymentProvider: s.paymentProvider,
      paymentKeyId: s.paymentKeyId,
      callbackUrls: {
        abdmProfileShare: `${base}/abdm/${tenantId}/profile-share`,
        paymentWebhook: s.paymentProvider === 'none' ? null : `${base}/payments/${s.paymentProvider}/${tenantId}`,
      },
      serverReady: { abdmSandbox: !!this.config.abdmSandbox, razorpay: !!this.config.razorpay },
      updatedAt: row ? iso(row.updatedAt) : null,
    };
  }
}
