import type { ErrorCode } from "@repo/contracts";

import type errors from "../locales/en/errors.json";

/**
 * Compile-time completeness for the `errors` catalogue (ADR-0046 §2).
 *
 * The catalogue is keyed by `ErrorCode`, so the key *is* the code and there is
 * no prefix to get wrong — but a JSON catalogue carries no type saying the set
 * is complete. A code added to `@repo/contracts` must fail this app's build
 * until somebody writes a sentence for it, or an operator meets a new failure
 * as a raw `SCREAMING_SNAKE` string.
 *
 * **Compiled, never imported at runtime.** Nothing imports this module; `tsc`
 * type-checks it because it is under `src`, and the bundler never sees it
 * because no reachable module names it. A completeness rule should cost a build
 * step, not a byte.
 *
 * **This app's own check over this app's own catalogue** — the sentences differ
 * from the admin's on purpose (a customer is told "contact support" where an
 * operator is told "ask an administrator"), so the rule has to be stated per
 * app even though its shape is identical. That is ADR-0046 §13's "an app owns
 * its dictionary" showing up as duplicated *structure* and not duplicated
 * words.
 *
 * If `check-types` fails here, the message names the missing codes — add them
 * to `locales/en/errors.json`, and `pnpm --filter customer i18n:check` will
 * then say which other locales lag.
 */
type MissingErrorKeys = Exclude<ErrorCode, keyof typeof errors>;

export const errorsCatalogueIsComplete: MissingErrorKeys extends never
  ? true
  : MissingErrorKeys = true;
