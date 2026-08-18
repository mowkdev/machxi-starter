import { z } from "zod";

import { SORT_DIRECTIONS, type SortDirection } from "./enums.js";
import { ERROR_CODES, type ApiError } from "./errors.js";

/**
 * The single response shape every endpoint uses (ADR-0012).
 *
 * `success` is the discriminator, `data` and `error` are mutually exclusive,
 * and `meta.requestId` is always present so any response can be traced back to
 * a log line (ADR-0010). A `204 No Content` carries no body at all and so has
 * no envelope.
 */

/** Offset-based pagination state echoed on every list response (ADR-0014). */
export interface Pagination {
  readonly offset: number;
  readonly limit: number;
  /**
   * Total number of matching rows. `null` is reserved for endpoints that opt
   * out of the `count(*)` on very large tables; every v1 endpoint returns a
   * number (ADR-0014 §Determinism).
   */
  readonly total: number | null;
}

/** One entry of the resolved `sort` order (ADR-0014). */
export interface SortSpec {
  readonly field: string;
  readonly direction: SortDirection;
}

/**
 * Response metadata. `pagination`, `sort` and `filters` are present on list
 * responses only, and echo the *resolved* query — defaults included — so a
 * client can render its table state without re-parsing its own URL.
 */
export interface Meta {
  readonly requestId: string;
  readonly pagination?: Pagination;
  readonly sort?: readonly SortSpec[];
  readonly filters?: Readonly<Record<string, unknown>>;
}

/** A single resource or object (`200`, or `201` from a create). */
export interface SuccessEnvelope<T> {
  readonly success: true;
  readonly data: T;
  readonly meta: Meta;
}

/** A collection; `meta.pagination` is guaranteed (ADR-0012). */
export interface ListEnvelope<T> {
  readonly success: true;
  readonly data: readonly T[];
  readonly meta: Meta & { readonly pagination: Pagination };
}

/** A failure, produced exclusively by the error middleware (ADR-0013). */
export interface ErrorEnvelope {
  readonly success: false;
  readonly error: ApiError;
  readonly meta: Meta;
}

/** Anything the API can return with a body. */
export type Envelope<T> = SuccessEnvelope<T> | ListEnvelope<T> | ErrorEnvelope;

/** Narrows an envelope to its failure branch. */
export const isErrorEnvelope = <T>(
  envelope: Envelope<T>,
): envelope is ErrorEnvelope => envelope.success === false;

/** Narrows an envelope to either success branch. */
export const isSuccessEnvelope = <T>(
  envelope: Envelope<T>,
): envelope is SuccessEnvelope<T> | ListEnvelope<T> =>
  envelope.success === true;

/**
 * Runtime schemas for the envelope.
 *
 * These exist for the envelope-conformance tests (ADR-0021) and for clients
 * that validate what they receive. They are deliberately **not strict**:
 * unknown keys are stripped rather than rejected, so adding a field to `meta`
 * stays the additive, non-breaking change ADR-0015 says it is. The interfaces
 * above are the contract; these schemas assert "at least this shape".
 */
export const paginationSchema = z.object({
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative().nullable(),
});

export const sortSpecSchema = z.object({
  field: z.string().min(1),
  direction: z.enum(SORT_DIRECTIONS),
});

export const metaSchema = z.object({
  requestId: z.string().min(1),
  pagination: paginationSchema.optional(),
  sort: z.array(sortSpecSchema).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
});

export const errorDetailSchema = z.object({
  path: z.string().optional(),
  message: z.string(),
  code: z.string().optional(),
});

export const apiErrorSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string().min(1),
  details: z.array(errorDetailSchema).optional(),
  debug: z
    .object({
      name: z.string(),
      message: z.string(),
      stack: z.string().optional(),
    })
    .optional(),
});

export const errorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: apiErrorSchema,
  meta: metaSchema,
});

/** Builds the schema of a single-resource response around a resource schema. */
export const successEnvelopeSchema = <T extends z.ZodType>(data: T) =>
  z.object({ success: z.literal(true), data, meta: metaSchema });

/** Builds the schema of a list response around an item schema. */
export const listEnvelopeSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    success: z.literal(true),
    data: z.array(item),
    meta: metaSchema.extend({ pagination: paginationSchema }),
  });
