import { describe, expect, it, vi } from "vitest";

import { apiClientError } from "../api-error";
import {
  BULK_CONCURRENCY,
  runBulkAction,
  type BulkTarget,
} from "../bulk-outcome";

/**
 * The bounded fan-out (ADR-0038, amended `D4.3`; ADR-0020).
 *
 * The concurrency bound and the stop are not performance tuning — they are what
 * keeps one confirm click from spending the whole per-IP budget ADR-0020's
 * global limiter shares with `/auth/login` and `/auth/refresh`, for every
 * operator behind the same egress IP.
 */

const targets = (count: number): readonly BulkTarget[] =>
  Array.from({ length: count }, (_, index) => ({
    id: String(index),
    label: `row-${index}`,
  }));

const rateLimited = () =>
  apiClientError({
    status: 429,
    code: "RATE_LIMITED",
    message: "Too many requests",
  });

const refused = () =>
  apiClientError({
    status: 409,
    code: "STAFF_LAST_SUPER_ADMIN",
    message: "Last super admin",
  });

describe("runBulkAction", () => {
  it("reports every success when nothing refuses", async () => {
    const outcome = await runBulkAction(targets(3), () => Promise.resolve());

    expect(outcome.deleted).toEqual(["0", "1", "2"]);
    expect(outcome.refused).toEqual([]);
    expect(outcome.unattempted).toEqual([]);
  });

  it("keeps a refusal to its own row, and names it from the code", async () => {
    const outcome = await runBulkAction(targets(3), (id) =>
      id === "1" ? Promise.reject(refused()) : Promise.resolve(),
    );

    /*
     * The semantic the fan-out exists to preserve (ADR-0028): the rules are per
     * row, so two lawful deletions are not rolled back because a third was
     * refused. The sentence comes from the `ErrorCode` map, never from the
     * API's own `message` (ADR-0013).
     */
    expect(outcome.deleted).toEqual(["0", "2"]);
    expect(outcome.refused).toEqual([
      {
        id: "1",
        label: "row-1",
        message: "This is the last super admin. Promote someone else first.",
      },
    ]);
  });

  it("never has more than the bound in flight at once", async () => {
    let inFlight = 0;
    let peak = 0;

    await runBulkAction(targets(BULK_CONCURRENCY * 3), async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
    });

    expect(peak).toBeLessThanOrEqual(BULK_CONCURRENCY);
  });

  it("stops issuing requests once the API rate-limits, and says what it skipped", async () => {
    const action = vi.fn((id: string) =>
      id === "0" ? Promise.reject(rateLimited()) : Promise.resolve(),
    );

    const all = targets(BULK_CONCURRENCY * 3);
    const outcome = await runBulkAction(all, action);

    /*
     * ADR-0020's global limiter does not set `skipFailedRequests`, so a
     * rejected request still increments the counter that rejected it. A
     * fan-out that kept going after the first `429` would spend the rest of the
     * operator's budget on requests guaranteed to fail — and take `login` and
     * `refresh` for the whole IP with it.
     */
    expect(action).toHaveBeenCalledTimes(BULK_CONCURRENCY);
    expect(outcome.unattempted).toHaveLength(BULK_CONCURRENCY * 2);

    /*
     * The batch that met the limit keeps its own refusals: those requests were
     * made and answered, and hiding them would understate what the budget was
     * spent on. Only what was never asked is `unattempted`.
     */
    expect(outcome.refused).toHaveLength(1);
    expect(outcome.deleted).toHaveLength(BULK_CONCURRENCY - 1);
  });

  it("does not stop for an ordinary refusal", async () => {
    const action = vi.fn((id: string) =>
      id === "0" ? Promise.reject(refused()) : Promise.resolve(),
    );

    const all = targets(BULK_CONCURRENCY * 2);
    const outcome = await runBulkAction(all, action);

    // A `409` is an answer about one row, not a signal about the connection.
    // Stopping on it would refuse work the operator is entitled to do.
    expect(action).toHaveBeenCalledTimes(all.length);
    expect(outcome.unattempted).toEqual([]);
  });
});
