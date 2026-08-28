import type { BulkOutcome } from "@repo/api-client";
import type { TranslateKey, TranslationKey } from "@repo/i18n";

/**
 * A bulk outcome as the one sentence an operator reads (ADR-0038, ADR-0034).
 *
 * **This is the aggregate exception, in one place.** ADR-0034's rule is that a
 * mutation declares a static `meta.success` and a global handler delivers it;
 * ADR-0038 carries a named exception for aggregate outcomes, because "7
 * deleted, 2 refused" has no static wording. Composing it here rather than in
 * each feature keeps the exception one file wide — the *policy* (codes →
 * messages, one map) is untouched, and this reads only what
 * {@link BulkOutcome} already resolved through it.
 *
 * The per-item lines are the point. ADR-0028's refusals are per row, so a
 * summary that said "2 refused" without saying which two and why would throw
 * away exactly what a transactional endpoint could not have told the operator.
 */

export interface BulkSummary {
  /** Which `toast.*` to call. The caller owns the surface; this owns the words. */
  readonly tone: "success" | "warning" | "error";
  readonly headline: string;
  readonly description?: string;
}

/**
 * `noun` is a **key** into the resource's own namespace (`staff:noun`,
 * `users:noun`) rather than a word, which is `D7.4` closing the half-answer
 * `D7.2` left recorded here.
 *
 * The two populations differ in what deletion *means* (ADR-0028: staff hard,
 * users soft), so the noun has always been the caller's. What changed twice is
 * where its **plural** comes from. `D7.2` moved the English `${noun}s` out of
 * this function and into `grid:bulk.deleted`'s `_one` / `_other` forms — which
 * pluralises the sentence and leaves the noun inside it singular, and is
 * therefore wrong for any language that declines. So the noun is now resolved
 * *with the same count* in its own namespace, where it carries its own plural
 * categories: `t("staff:noun", { count })` is `staff account` at one and
 * `staff accounts` at three, and a Latvian catalogue can answer with three
 * forms because `_zero` / `_one` / `_other` is grammar rather than style.
 *
 * `t` is the app-wide translator for the same reason: this module's own keys
 * are `grid:`, the noun's is the resource's, and `shared/notifications` may
 * name neither resource (ADR-0032).
 */
export const summariseBulk = (
  outcome: BulkOutcome,
  noun: TranslationKey,
  t: TranslateKey,
): BulkSummary => {
  const { deleted, refused, unattempted } = outcome;

  if (refused.length === 0 && unattempted.length === 0)
    return {
      tone: "success",
      headline: t("grid:bulk.deleted", {
        count: deleted.length,
        noun: t(noun, { count: deleted.length }),
      }),
    };

  const lines = refused.map((item) =>
    t("grid:bulk.refusal", { label: item.label, message: item.message }),
  );

  /*
   * The stopped remainder is its own sentence, not another refusal. A refusal
   * is the server's answer about that row; these were never asked, and the two
   * have opposite remedies — "you may not" against "try again in a few
   * minutes". Saying "40 refused" for 40 unattempted rows would send an
   * operator hunting for a permission problem that does not exist.
   */
  if (unattempted.length > 0)
    lines.push(t("grid:bulk.unattemptedLine", { count: unattempted.length }));

  const parts = [t("grid:bulk.partDeleted", { count: deleted.length })];

  if (refused.length > 0)
    parts.push(t("grid:bulk.partRefused", { count: refused.length }));
  if (unattempted.length > 0)
    parts.push(t("grid:bulk.partUnattempted", { count: unattempted.length }));

  return {
    // Nothing deleted is a failure; a mixed result is not, and calling it one
    // would tell an operator to undo work that succeeded.
    tone: deleted.length === 0 ? "error" : "warning",
    headline: t("grid:bulk.headline", { parts: parts.join(", ") }),
    description: lines.join("\n"),
  };
};
