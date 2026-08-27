/**
 * The door onto `@repo/api-client`'s error surface (`D9.1`, ADR-0051).
 *
 * The code moved; the import path every feature writes did not. ADR-0051
 * generalises ADR-0047's one-door pattern: a slice under `shared/` re-exports
 * from the package, and `no-restricted-imports` keeps `@repo/api-client` out
 * of every layer above. This file is a door and holds no logic.
 */
export {
  apiClientError,
  isApiClientError,
  TRANSPORT_ERROR_CODE,
  type ApiClientError,
  type ApiClientErrorData,
  type ErrorMessage,
} from "@repo/api-client";
