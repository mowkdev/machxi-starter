import type { BulkOutcome } from "@/shared/api/bulk-outcome";

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
 * `noun` is the resource's singular ("staff account", "user account"), because
 * the two populations differ in what deletion *means* (ADR-0028: staff hard,
 * users soft) and the copy should not pretend otherwise.
 */
export const summariseBulk = (
  outcome: BulkOutcome,
  noun: string,
): BulkSummary => {
  const { deleted, refused, unattempted } = outcome;
  const plural = (count: number) => (count === 1 ? noun : `${noun}s`);

  if (refused.length === 0 && unattempted.length === 0)
    return {
      tone: "success",
      headline: `${deleted.length} ${plural(deleted.length)} deleted.`,
    };

  const lines = refused.map((item) => `${item.label}: ${item.message}`);

  /*
   * The stopped remainder is its own sentence, not another refusal. A refusal
   * is the server's answer about that row; these were never asked, and the two
   * have opposite remedies — "you may not" against "try again in a few
   * minutes". Saying "40 refused" for 40 unattempted rows would send an
   * operator hunting for a permission problem that does not exist.
   */
  if (unattempted.length > 0)
    lines.push(
      `${unattempted.length} not attempted — the API is rate limiting this session. Wait a few minutes and try the rest.`,
    );

  const parts = [`${deleted.length} deleted`];

  if (refused.length > 0) parts.push(`${refused.length} refused`);
  if (unattempted.length > 0) parts.push(`${unattempted.length} not attempted`);

  return {
    // Nothing deleted is a failure; a mixed result is not, and calling it one
    // would tell an operator to undo work that succeeded.
    tone: deleted.length === 0 ? "error" : "warning",
    headline: `${parts.join(", ")}.`,
    description: lines.join("\n"),
  };
};
