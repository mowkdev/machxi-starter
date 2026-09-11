import {
  federatedCallbackQuery,
  federatedExchangeBody,
  federatedStartBody,
} from "@repo/contracts";

/**
 * The route schemas of sign-in with Google (ADR-0011, ADR-0023, ADR-0072 §2).
 *
 * Re-exported from `@repo/contracts` for the reason every other module's
 * schema file gives. The callback's query schema is the one in this API that
 * **cannot fail** — every field falls back to absent — because a validation
 * error on a browser navigation would be JSON on a bare page, and the route
 * answers every refusal with a redirect instead (the contract says why).
 */

export const federatedStartSchema = { body: federatedStartBody } as const;
export const federatedCallbackSchema = {
  query: federatedCallbackQuery,
} as const;
export const federatedExchangeSchema = { body: federatedExchangeBody } as const;
