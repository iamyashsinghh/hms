import { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validates and parses input with a shared Zod schema from @hms/shared.
 *   @Body(new ZodPipe(createPatientSchema)) body: CreatePatient
 */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    return this.schema.parse(value ?? {});
  }
}
