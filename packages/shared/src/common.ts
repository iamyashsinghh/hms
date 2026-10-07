import { z } from 'zod';

export const uuid = z.uuid();

/** Every error response from the API has this shape. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type PaginationQuery = {
  page?: number;
  pageSize?: number;
};

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export const API_PREFIX = '/api/v1';

/** Header carrying the facility (branch) the user is working in. */
export const FACILITY_HEADER = 'x-facility-id';
