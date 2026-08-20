import { isApiClientError } from "@/shared/api/api-error";
import { messageForError } from "@/shared/notifications/messages";

/**
 * Running a per-row action over a selection, and reporting what happened
 * (ADR-0038 §Bulk delete).
 *
 * It lives in `shared/api` rather than in either feature because both
 * `staff-manage` and `users-manage` run the same fan-out and ADR-0032 allows no
 * sideways import between features — the shape of an aggregate outcome is not
 * domain knowledge, so `shared` is where the boundary puts it. What *is* domain
 * knowledge stays with the feature: which endpoint is called, and the copy that
 * describes the deletion's softness or hardness.
 *
 * **Per-item refusal is the correct semantic, not a compromise.** ADR-0028's
 * rules are per-row — one of nine selected staff being the actor, or the last
 * active super admin, refuses *that* delete with *its* code while the other
 * eight are legitimate — so a summary that collapsed to "failed" would discard
 * the only thing the fan-out buys over a transactional endpoint.
 */

/**
 * How many requests are in flight at once.
 *
 * **Amended into ADR-0038 at `D4.3` after the security review**, which is worth
 * stating plainly because the ADR's own cost paragraph reads as though this were
 * already handled. It says N requests are "fine at admin scale, where a
 * selection is tens of rows, not thousands" — an assumption with nothing
 * enforcing it. `GridPager` offers 100 rows a page and selection deliberately
 * survives paging *and* filtering, so three "select all on this page" clicks
 * stage 300 targets, which is the whole of ADR-0020's global
 * `300 / 15 min / IP` budget in one confirm. That limiter sits above `/auth`,
 * so the collateral is `login` and `refresh` for **every operator behind the
 * same egress IP** for the rest of the window.
 *
 * Five at a time does not change the total a legitimate deletion of 300 rows
 * costs — that is real work and it should cost real requests. What it buys is
 * that the burst is paced rather than instantaneous, and, with the stop below,
 * that the client stops adding to a counter that is already refusing it.
 */
export const BULK_CONCURRENCY = 5;

/**
 * One row staged for a bulk action.
 *
 * The label travels with the id because the summary has to name refusals to an
 * operator, and the id alone would name them to nobody: a selection survives
 * paging (ADR-0038), so by the time a refusal is reported the row it refers to
 * may not be on screen. The caller resolves the label from whatever it holds
 * and falls back to the id, which is the honest floor rather than a blank.
 */
export interface BulkTarget {
  readonly id: string;
  readonly label: string;
}

export interface BulkRefusal {
  readonly id: string;
  readonly label: string;
  /** From the one `ErrorCode` map (ADR-0034); never the API's own `message`. */
  readonly message: string;
}

export interface BulkOutcome {
  readonly deleted: readonly string[];
  readonly refused: readonly BulkRefusal[];
  /**
   * Targets the runner stopped before reaching, because the API started
   * answering `RATE_LIMITED`.
   *
   * Reported separately rather than folded into `refused`, because they are a
   * different fact about a different thing: a refusal is the server's answer
   * about *that row*, and these were never asked. Collapsing them would tell an
   * operator that forty accounts were refused when forty were not attempted,
   * and the two have opposite remedies — one is "you may not", the other is
   * "try again in a few minutes".
   */
  readonly unattempted: readonly BulkTarget[];
}

const refusalFor = (target: BulkTarget, reason: unknown): BulkRefusal => ({
  id: target.id,
  label: target.label,
  // The sentence comes from the code, in one file, exactly as a toast for a
  // single refusal would (ADR-0034). The API's own `message` is a
  // developer-facing default and is never rendered (ADR-0013).
  message: messageForError(reason),
});

const isRateLimited = (reason: unknown): boolean =>
  isApiClientError(reason) && reason.code === "RATE_LIMITED";

/**
 * Runs `action` over every target, `BULK_CONCURRENCY` at a time, and stops
 * dead the first time the API says `RATE_LIMITED`.
 *
 * **Stopping is the half that matters.** ADR-0020's global limiter does not set
 * `skipFailedRequests`, so a rejected request still increments the counter that
 * rejected it: a fan-out that kept going after the first `429` would spend the
 * operator's remaining budget on requests guaranteed to fail, and take the
 * whole IP's `login` and `refresh` with it. The same argument covers the retry
 * amplification — the client's single-flight refresh (ADR-0033) collapses N
 * `401`s into one refresh and then replays all N, so an unbounded fan-out is up
 * to 2N+1 requests for one click.
 *
 * `Promise.allSettled` per batch rather than per selection, because the point is
 * to see each batch's answers *before* issuing the next one. Within a batch the
 * ordering guarantee is `allSettled`'s: results come back positionally, which is
 * what makes the zip with `slice` sound.
 */
export const runBulkAction = async (
  targets: readonly BulkTarget[],
  action: (id: string) => Promise<unknown>,
): Promise<BulkOutcome> => {
  const deleted: string[] = [];
  const refused: BulkRefusal[] = [];

  for (let start = 0; start < targets.length; start += BULK_CONCURRENCY) {
    const batch = targets.slice(start, start + BULK_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((target) => action(target.id)),
    );

    let limited = false;

    batch.forEach((target, index) => {
      const result = results[index];

      if (result?.status === "fulfilled") {
        deleted.push(target.id);

        return;
      }

      if (isRateLimited(result?.reason)) limited = true;

      refused.push(refusalFor(target, result?.reason));
    });

    /*
     * Everything after this batch is reported as unattempted rather than tried.
     * The batch that met the limit keeps its own refusals — those requests were
     * made and answered, and hiding them would understate what the budget was
     * spent on.
     */
    if (limited)
      return {
        deleted,
        refused,
        unattempted: targets.slice(start + BULK_CONCURRENCY),
      };
  }

  return { deleted, refused, unattempted: [] };
};
