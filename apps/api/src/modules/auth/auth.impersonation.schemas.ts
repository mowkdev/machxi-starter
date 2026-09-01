import { impersonateBody, userIdParams } from "@repo/contracts";

/**
 * The route schemas of the impersonation flow (ADR-0011, ADR-0023).
 *
 * Re-exported from `@repo/contracts` rather than declared here, for the reason
 * every other module's schema file gives: the admin app validates the same id
 * and the customer app the same token, so a value the server rejects is a
 * value neither client sends.
 *
 * `userIdParams` is the users module's own params schema, and using it here is
 * the point rather than a shortcut — the mint's URL *is*
 * `/admin/users/:id/impersonate`, and a second uuid schema for the same path
 * segment would be a second place for it to drift.
 */

export const mintImpersonationSchema = { params: userIdParams } as const;
export const exchangeImpersonationSchema = { body: impersonateBody } as const;
