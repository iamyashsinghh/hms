import 'reflect-metadata';
import fastifyCookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { loadConfig } from './config';

/** Builds the HTTP app (used by main.ts and the e2e tests). */
export async function createApp(opts: { logger?: boolean } = {}): Promise<NestFastifyApplication> {
  const config = loadConfig();
  const adapter = new FastifyAdapter({
    trustProxy: true,
    genReqId: (req: { headers: Record<string, string | string[] | undefined> }) => (req.headers['x-request-id'] as string) ?? randomUUID(),
    bodyLimit: 5 * 1024 * 1024,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
    // Keeps the exact request bytes on req.rawBody (RawBodyRequest) for webhook signature checks.
    rawBody: true,
    logger: opts.logger === false ? false : undefined,
  });
  if (opts.logger !== false) app.useLogger(app.get(Logger));
  await app.register(fastifyCookie);
  await app.register(helmet, { contentSecurityPolicy: false });
  app.enableCors({ origin: config.API_CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: true });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  return app;
}
