import { HttpException, HttpStatus } from '@nestjs/common';

/** Throw with a stable machine-readable code the clients can switch on. */
export class AppError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, details?: unknown) {
    super({ code, message, details }, status);
  }
}

export const notFound = (what = 'Record') => new AppError(HttpStatus.NOT_FOUND, 'not_found', `${what} not found`);
export const forbidden = (message = 'You do not have permission to do this') =>
  new AppError(HttpStatus.FORBIDDEN, 'forbidden', message);
export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(HttpStatus.BAD_REQUEST, code, message, details);
export const conflict = (code: string, message: string) => new AppError(HttpStatus.CONFLICT, code, message);
