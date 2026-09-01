import type { StaffRole, UserRole } from "@repo/contracts";
import type { Logger } from "@repo/logger";

/**
 * The per-request object every layer reads from (ADR-0010).
 *
 * It exists so that services never receive `req` (ADR-0009) and never have to
 * take a logger, a request id and a principal as separate parameters.
 * Controllers pass it as the **first argument** of every service call.
 *
 * It is a fixed, typed structure: request bodies and feature-specific state do
 * not go here, they go in service arguments.
 */

/**
 * Who is authenticated, discriminated by population (ADR-0017).
 *
 * `roles` are loaded at authentication time so a guard (ADR-0019) needs no
 * extra query, and `sessionId` is what logout and refresh-reuse detection act
 * on (ADR-0018). This is the **server-side** principal; the wire form is
 * `PrincipalResource` in `@repo/contracts` and carries no `sessionId`.
 */
export type Principal =
  | {
      readonly kind: "staff";
      readonly id: string;
      readonly roles: readonly StaffRole[];
      readonly sessionId: string;
    }
  | {
      readonly kind: "user";
      readonly id: string;
      readonly roles: readonly UserRole[];
      readonly sessionId: string;
      /**
       * The **staff** member acting as this principal, on a session minted by
       * impersonation (ADR-0057 §4). Absent on every ordinary session.
       *
       * An id and nothing more: the wire form's `impersonatedBy: { id, email }`
       * is resolved from the staff table at the auth endpoints, and resolving
       * an address here would be a second primary-key probe on every
       * authenticated request. `authenticate` reads it off the access token's
       * RFC 8693 `act` claim, which the exchange stamped from the same session
       * row and which nothing ever rewrites.
       *
       * It is on the customer shape alone, because the mint is
       * `/admin/users/:id` only: a staff principal is never impersonated, and
       * a field it cannot hold is one no guard has to check for it.
       */
      readonly impersonatedBy?: string | undefined;
    };

export interface RequestContext {
  readonly requestId: string;
  /** `performance.now()` at the start of the request, for durations. */
  readonly startedAt: number;
  /** Child logger, pre-bound with `requestId` (and the principal after auth). */
  logger: Logger;
  /** `null` until the authentication middleware sets it (ADR-0018). */
  principal: Principal | null;
  /** `'en'` until the i18n ADR lands. */
  readonly locale: string;
  readonly ip: string | undefined;
  readonly userAgent: string | undefined;
}

/** Default locale until `Accept-Language` negotiation is decided (ADR-0010). */
export const DEFAULT_LOCALE = "en";

export interface CreateRequestContextInput {
  readonly requestId: string;
  readonly logger: Logger;
  readonly ip?: string | undefined;
  readonly userAgent?: string | undefined;
  readonly locale?: string;
  readonly startedAt?: number;
}

/** Builds a context for an HTTP request. Called by the context middleware. */
export const createRequestContext = ({
  requestId,
  logger,
  ip,
  userAgent,
  locale = DEFAULT_LOCALE,
  startedAt = performance.now(),
}: CreateRequestContextInput): RequestContext => ({
  requestId,
  startedAt,
  logger,
  principal: null,
  locale,
  ip,
  userAgent,
});

/**
 * Builds a context for code that runs outside Express — a seeder, a CLI, a
 * scheduled job.
 *
 * `principal` is `null` and stays `null`: there is deliberately no `system`
 * principal variant, so a service that requires one refuses rather than
 * silently acting with unbounded authority (ADR-0010).
 */
export const createSystemContext = (
  name: string,
  logger: Logger,
): RequestContext =>
  createRequestContext({
    requestId: `system:${name}`,
    logger: logger.child({ system: name }),
  });
