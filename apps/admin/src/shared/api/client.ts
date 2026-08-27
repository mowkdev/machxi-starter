/** The door onto the API client (`D9.1`, ADR-0051). See `./api-error`. */
export {
  createApiClient,
  CSRF_HEADER,
  isTerminalAuthCode,
  TERMINAL_AUTH_CODES,
  TRANSPORT_HEADER,
  type ApiClient,
  type ApiClientDeps,
  type ApiSegment,
} from "@repo/api-client";
