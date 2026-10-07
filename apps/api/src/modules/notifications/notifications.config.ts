import { z } from 'zod';

/** Provider settings for this module. Every channel defaults to the console provider, which sends nothing. */
const schema = z.object({
  NOTIFY_SMS_PROVIDER: z.enum(['console', 'msg91']).default('console'),
  NOTIFY_WHATSAPP_PROVIDER: z.enum(['console', 'gupshup']).default('console'),
  NOTIFY_EMAIL_PROVIDER: z.enum(['console', 'ses']).default('console'),
  NOTIFY_PUSH_PROVIDER: z.enum(['console', 'expo']).default('console'),
  /** Credits every new hospital gets once (1 credit = Rs 1). */
  NOTIFY_WELCOME_CREDITS: z.coerce.number().min(0).default(100),
  MSG91_AUTH_KEY: z.string().optional(),
  GUPSHUP_API_KEY: z.string().optional(),
  GUPSHUP_SOURCE: z.string().optional(),
  GUPSHUP_APP_NAME: z.string().optional(),
  AWS_REGION: z.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  SES_FROM_EMAIL: z.string().optional(),
  EXPO_ACCESS_TOKEN: z.string().optional(),
});

export type NotifyConfig = z.infer<typeof schema>;

export function loadNotifyConfig(env: NodeJS.ProcessEnv = process.env): NotifyConfig {
  return schema.parse(env);
}
