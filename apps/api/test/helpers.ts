import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/bootstrap';

export const DEMO = { tenantCode: 'demo', password: 'Demo@12345' };

export async function bootApp(): Promise<NestFastifyApplication> {
  const app = await createApp({ logger: false });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

export async function login(app: NestFastifyApplication, identifier: string, tenantCode = DEMO.tenantCode) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { tenantCode, identifier, password: DEMO.password, client: 'mobile' },
  });
  if (res.statusCode !== 200) throw new Error(`login ${identifier} failed: ${res.body}`);
  return res.json() as { accessToken: string; refreshToken: string; user: { id: string; permissions: string[] } };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
