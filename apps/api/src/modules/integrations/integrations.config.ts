/**
 * Server-side settings for the integrations module, read from environment variables. Secrets for
 * live adapters (ABDM sandbox, Razorpay) only ever come from here, never from the database.
 * Development defaults exist for the mock adapters; production must set its own values.
 */
export interface IntegrationsConfig {
  /** Public base URL of the API, used to show callback URLs (e.g. https://api.example.com/api/v1). */
  publicApiUrl: string;
  /** HMAC secret the ABDM simulator (and our profile-share callback check) uses. */
  abdmCallbackSecret: string;
  abdmSandbox: { clientId: string; clientSecret: string } | null;
  mockPaymentWebhookSecret: string;
  razorpay: { keySecret: string; webhookSecret: string } | null;
  /** Off by default: webhook deliveries are recorded but not sent (dry run). */
  webhooksLive: boolean;
}

const DEV_SECRET = 'hms-dev-integrations-secret-change-me';

export function loadIntegrationsConfig(env: NodeJS.ProcessEnv = process.env): IntegrationsConfig {
  const prod = env.NODE_ENV === 'production';
  const devDefault = (v: string | undefined) => v || (prod ? '' : DEV_SECRET);
  return {
    publicApiUrl: (env.PUBLIC_API_URL || `http://localhost:${env.API_PORT || 4000}/api/v1`).replace(/\/$/, ''),
    abdmCallbackSecret: devDefault(env.ABDM_CALLBACK_SECRET),
    abdmSandbox:
      env.ABDM_SANDBOX_CLIENT_ID && env.ABDM_SANDBOX_CLIENT_SECRET
        ? { clientId: env.ABDM_SANDBOX_CLIENT_ID, clientSecret: env.ABDM_SANDBOX_CLIENT_SECRET }
        : null,
    mockPaymentWebhookSecret: devDefault(env.MOCK_PAYMENT_WEBHOOK_SECRET),
    razorpay:
      env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET
        ? { keySecret: env.RAZORPAY_KEY_SECRET, webhookSecret: env.RAZORPAY_WEBHOOK_SECRET }
        : null,
    webhooksLive: env.INTEGRATIONS_WEBHOOKS_LIVE === 'true',
  };
}

export const INTEGRATIONS_CONFIG = Symbol('INTEGRATIONS_CONFIG');
