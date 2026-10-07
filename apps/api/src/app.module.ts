import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './config';
import { AuthCommonModule } from './common/auth/auth-common.module';
import { AuthGuard } from './common/auth/auth.guard';
import { ContextInterceptor } from './common/context/context.interceptor';
import { CoreInfraModule } from './common/db/db.module';
import { AllExceptionsFilter } from './common/errors/http-exception.filter';
import { QueueModule } from './common/queue/queue.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { PatientsModule } from './modules/patients/patients.module';
import { FEATURE_MODULES } from './modules';

const config = loadConfig();

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: config.LOG_LEVEL,
        genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
        redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
        autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
      },
    }),
    CoreInfraModule,
    QueueModule,
    AuthCommonModule,
    HealthModule,
    AuthModule,
    PatientsModule,
    ...FEATURE_MODULES,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ContextInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
