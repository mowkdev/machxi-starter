/** The door onto the API client (ADR-0033 as carried by ADR-0051). */
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
