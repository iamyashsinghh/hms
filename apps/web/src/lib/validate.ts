import type { z } from 'zod';

/** Field path ("lines.0.qty") → first error message for it. */
export type FieldErrors = Record<string, string>;

/**
 * Checks form values against a shared schema before sending them, for forms that keep their
 * values in useState instead of react-hook-form. Returns the parsed data or the errors by field.
 */
export function validate<S extends z.ZodType>(schema: S, values: unknown): { data: z.output<S>; errors: null } | { data: null; errors: FieldErrors } {
  const r = schema.safeParse(values);
  if (r.success) return { data: r.data, errors: null };
  const errors: FieldErrors = {};
  for (const issue of r.error.issues) {
    const key = issue.path.map(String).join('.') || '_form';
    errors[key] ??= issue.message;
  }
  return { data: null, errors };
}

/** The first error, for forms that show one message at the top. */
export function firstError(errors: FieldErrors | null): string | null {
  if (!errors) return null;
  return Object.values(errors)[0] ?? null;
}
