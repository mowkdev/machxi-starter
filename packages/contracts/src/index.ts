/**
 * `@repo/contracts` — the HTTP contract of the API, shared with every client
 * (ADR-0023).
 *
 * Holds zod schemas for request bodies, queries and params; hand-written types
 * for the resources mappers produce; the response envelope; the error-code
 * union; and the enums that the database (`pgEnum`), the API (validation) and
 * the UIs all derive from one declaration.
 *
 * Depends on `zod` and nothing else — no ORM, no Express, no Node built-ins —
 * so it is safe in a browser bundle and cannot drag the server into one.
 */

export {
  POPULATIONS,
  SORT_DIRECTIONS,
  STAFF_ROLES,
  STAFF_STATUSES,
  SUPER_ADMIN_ROLE,
  USER_ROLES,
  USER_STATUSES,
  type Population,
  type Role,
  type SortDirection,
  type StaffRole,
  type StaffStatus,
  type UserRole,
  type UserStatus,
} from "./enums.js";

export {
  ERROR_CODES,
  type ApiError,
  type ErrorCode,
  type ErrorDetail,
} from "./errors.js";

export {
  apiErrorSchema,
  errorDetailSchema,
  errorEnvelopeSchema,
  isErrorEnvelope,
  isSuccessEnvelope,
  listEnvelopeSchema,
  metaSchema,
  paginationSchema,
  sortSpecSchema,
  successEnvelopeSchema,
  type Envelope,
  type ErrorEnvelope,
  type ListEnvelope,
  type Meta,
  type Pagination,
  type SortSpec,
  type SuccessEnvelope,
} from "./envelope.js";

export {
  DEFAULT_LIMIT,
  FILTER_OPS,
  LIST_QUERY_PARAMS,
  MAX_LIMIT,
  MAX_SEARCH_LENGTH,
  SCALAR_FILTER_OPS,
  filterSchema,
  filtersToRecord,
  listQuerySchema,
  listQuerySearchSchema,
  type Filter,
  type FilterFieldSpec,
  type FilterOp,
  type FilterSpec,
  type ListQuery,
  type ListQueryOptions,
  type ListQuerySearch,
  type Page,
  type ScalarFilterOp,
} from "./list-query.js";

export {
  isListSearchState,
  parseListSearch,
  stringifyListSearch,
  type ListSearchState,
} from "./list-search.js";

export {
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  emailSchema,
  idSchema,
  nameSchema,
  passwordSchema,
  presentedPasswordSchema,
  type IsoDateTime,
} from "./primitives.js";

/**
 * The keyed custom messages and their source catalogue (ADR-0046 §6).
 *
 * Importing this barrel installs the source error map, because
 * `./locales/source.js` does so on evaluation — which is what keeps the API's
 * validation copy exactly what it was with no line of API code. The Latvian
 * map is **not** here: it lives behind the `@repo/contracts/locales/lv`
 * subpath so a client that never switches to Latvian never bundles it.
 */
export {
  CUSTOM_MESSAGES,
  CUSTOM_MESSAGE_KEYS,
  createCustomMessageError,
  customRule,
  type CustomMessageKey,
} from "./locales/source.js";

export {
  HEALTH_STATUSES,
  type HealthCheckResource,
  type HealthResource,
  type HealthStatus,
} from "./health.js";

export * from "./auth/index.js";
export * from "./settings/index.js";
export * from "./staff/index.js";
export * from "./users/index.js";
