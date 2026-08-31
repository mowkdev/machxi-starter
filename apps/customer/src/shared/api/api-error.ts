/**
 * The door onto `@repo/api-client`'s error surface (ADR-0051).
 *
 * The one-door pattern ADR-0047 set for the design system and ADR-0051
 * generalised: a slice under `shared/` re-exports from the package, and
 * `no-restricted-imports` keeps `@repo/api-client` out of every layer above.
 * This file is a door and holds no logic.
 */
export {
  apiClientError,
  isApiClientError,
  TRANSPORT_ERROR_CODE,
  type ApiClientError,
  type ApiClientErrorData,
  type ErrorMessage,
} from "@repo/api-client";
