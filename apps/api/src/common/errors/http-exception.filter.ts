import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ApiErrorBody } from '@hms/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

const PG_ERRORS: Record<string, { status: number; code: string; message: string }> = {
  '23505': { status: 409, code: 'conflict', message: 'A record with these details already exists' },
  '23503': { status: 409, code: 'reference_error', message: 'A linked record does not exist or is still in use' },
  '23514': { status: 400, code: 'constraint_violation', message: 'A value is not allowed' },
  '23502': { status: 400, code: 'missing_value', message: 'A required value is missing' },
  '42501': { status: 403, code: 'forbidden', message: 'Not allowed' },
};

function statusCode(status: number): string {
  return (HttpStatus[status] ?? 'error').toLowerCase();
}

/** Names the first few problems so forms without per-field errors still say what is wrong. */
export function validationMessage(err: ZodError): string {
  const parts = [...new Set(err.issues.map((i) => {
    const field = i.path.filter((p) => typeof p === 'string').at(-1);
    const generic = /^(Invalid input|Required|Too (small|big)|Invalid)/i.test(i.message);
    return generic && field ? `${String(field)}: ${i.message}` : i.message;
  }))];
  if (!parts.length) return 'Some fields are invalid';
  return parts.length > 3 ? `${parts.slice(0, 3).join('; ')} (and ${parts.length - 3} more)` : parts.join('; ');
}

/** Every error leaves the API as { error: { code, message, details?, requestId } }. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const req = host.switchToHttp().getRequest<FastifyRequest>();
    const requestId = String(req.id);
    let status = 500;
    let body: ApiErrorBody['error'] = { code: 'internal_error', message: 'Something went wrong', requestId };

    if (exception instanceof ZodError) {
      status = 400;
      body = { code: 'validation_failed', message: validationMessage(exception), details: exception.issues, requestId };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'object' && res && 'code' in res) {
        const r = res as { code: string; message?: string; details?: unknown };
        body = { code: r.code, message: r.message ?? exception.message, details: r.details, requestId };
      } else {
        const msg = typeof res === 'string' ? res : ((res as { message?: string | string[] }).message ?? exception.message);
        body = { code: statusCode(status), message: Array.isArray(msg) ? msg.join(', ') : msg, requestId };
      }
    } else {
      const pgCode = pgErrorCode(exception);
      const mapped = pgCode ? PG_ERRORS[pgCode] : undefined;
      if (mapped) {
        status = mapped.status;
        body = { code: mapped.code, message: mapped.message, requestId };
      }
    }

    if (status >= 500 && process.env.DEBUG_ERRORS) console.error(exception);
    if (status >= 500) this.logger.error({ err: exception, requestId }, 'unhandled error');
    void reply.status(status).send({ error: body });
  }
}

/** Postgres error code, also when wrapped by Drizzle (err.cause). */
function pgErrorCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 3 && cur && typeof cur === 'object'; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}
