/**
 * The browser API client, extracted (`D9.1`, [ADR-0051](../../../docs/adr/0051-platform-extraction.md)).
 *
 * Everything [ADR-0033](../../../docs/adr/0033-browser-api-client-and-session.md)
 * decided, unchanged and now living here instead of in `apps/admin/src/shared/api`:
 * the axios instance with its envelope and error handling, the in-memory
 * session store, the single-flight refresh, the CSRF bootstrap of
 * [ADR-0029](../../../docs/adr/0029-csrf-strategy.md) /
 * [ADR-0030](../../../docs/adr/0030-csrf-bootstrap-endpoint.md), and the
 * URL⇄query serialization of [ADR-0043](../../../docs/adr/0043-readable-list-search-params.md).
 * 0033 keeps every decision it made; what it lost is the code's address, which
 * is the whole of ADR-0051's delta against it.
 *
 * **One generalisation, and only one**: `createApiClient` takes a `segment`.
 * `apps/admin` passes `"admin"`, the customer app will pass `"user"` (D11).
 * Nothing else in this package knows which population it is serving, and the
 * one place that used to — `useSetPrincipal`'s staff-narrowed parameter — is
 * pinned by each app's own door instead.
 *
 * **Named exports through one entry point**, which is what lets each app's
 * `shared/api` be a door and its `no-restricted-imports` group name a single
 * path. Nothing is exported that the app did not already import.
 */

export {
  apiClientError,
  isApiClientError,
  TRANSPORT_ERROR_CODE,
  type ApiClientError,
  type ApiClientErrorData,
  type ErrorMessage,
} from "./api-error";

export { createBootstrap, type BootstrapOutcome } from "./bootstrap";

export {
  createApiClient,
  CSRF_HEADER,
  isTerminalAuthCode,
  TERMINAL_AUTH_CODES,
  TRANSPORT_HEADER,
  type ApiClient,
  type ApiClientDeps,
  type ApiSegment,
} from "./client";

export {
  ApiProvider,
  useApiClient,
  useSession,
  useSetPrincipal,
  type ApiContextValue,
  type SessionView,
} from "./context";

export { CREDENTIAL_MUTATION } from "./credential-mutation";

export { serializeListParams, toListQuery } from "./list-params";

export { parseAdminSearch, stringifyAdminSearch } from "./search-params";

export {
  createSessionStore,
  type SessionPatch,
  type SessionSnapshot,
  type SessionStore,
} from "./session-store";
