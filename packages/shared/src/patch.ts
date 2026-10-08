import { z } from 'zod';

type PatchShape<S extends z.ZodRawShape> = {
  [K in keyof S]: z.ZodOptional<S[K] extends z.ZodDefault<infer Inner> ? Inner : S[K]>;
};

/**
 * PATCH body schema from a create schema: every field optional and **no defaults**.
 *
 * Zod 4 applies `.default()` even inside `.partial()`, so `createSchema.partial().parse({ name })`
 * fills every defaulted field back in (isActive → true, rates → 0, ranges → []) and a partial
 * update silently resets them. Use this instead of `.partial()` for update schemas.
 */
export function patchSchema<S extends z.ZodRawShape>(schema: z.ZodObject<S>): z.ZodObject<PatchShape<S>> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    const inner = field instanceof z.ZodDefault ? (field.unwrap() as z.ZodType) : (field as z.ZodType);
    shape[key] = inner.optional();
  }
  return z.object(shape) as unknown as z.ZodObject<PatchShape<S>>;
}
