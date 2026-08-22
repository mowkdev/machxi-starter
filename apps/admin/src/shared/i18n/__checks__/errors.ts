import type { ErrorCode } from "@repo/contracts";

import type errors from "../locales/en/errors.json";

/**
 * The compile-time completeness `ERROR_MESSAGES` used to give, kept after the
 * map became a catalogue (ADR-0046 §2, `D7.2`).
 *
 * `Record<ErrorCode, string>` was doing real work in `shared/notifications`: a
 * code added to `@repo/contracts` failed the admin build until somebody wrote a
 * sentence for it, so an operator could never meet a new failure as a raw
 * `SCREAMING_SNAKE` string. A JSON catalogue has no such type — every key is
 * just a key — so the guarantee has to be restated somewhere, and this is the
 * somewhere.
 *
 * **Compiled, never imported at runtime.** Nothing imports this module; `tsc`
 * type-checks it because it is under `src`, and the bundler never sees it
 * because no reachable module names it. That is the point: a completeness rule
 * should cost a build step, not a byte.
 *
 * If `check-types` fails here, the message names the missing codes — add them
 * to `locales/en/errors.json` (and, from `D7.6`, let the drift check tell you
 * which other locales now lag).
 */
type MissingErrorKeys = Exclude<ErrorCode, keyof typeof errors>;

export const errorsCatalogueIsComplete: MissingErrorKeys extends never
  ? true
  : MissingErrorKeys = true;
