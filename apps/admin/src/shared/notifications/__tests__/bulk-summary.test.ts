import { describe, expect, it } from "vitest";

import type { BulkOutcome } from "@/shared/api/bulk-outcome";
import type { TranslateKey } from "@/shared/i18n";
import { createTestI18n } from "@/test/render";

import { summariseBulk } from "../bulk-summary";

/**
 * The aggregate outcome's one sentence (ADR-0038, ADR-0034 §Notifications),
 * now composed from the `grid` catalogue (`D7.2`, ADR-0046 §1).
 *
 * Two things are worth an assertion here and were not before. The **counts go
 * through `Intl.PluralRules`** — the mechanism ADR-0046 §1 chose i18next's
 * suffix keys for, and the one Latvian's three categories will exercise in
 * `D7.6` — so a summary that read "1 staff accounts deleted" is now a
 * catalogue bug rather than a string-concatenation one. And the **tone** is
 * still decided here rather than by the words: a mixed result is a warning, and
 * calling it an error would tell an operator to undo work that succeeded.
 *
 * The sentences below are unchanged from D4's, which is the property "keeping
 * `en` as the test locale" buys — localising the summary did not reword it.
 */

/*
 * The **app-wide** translator since `D7.4`: the noun is a key in the
 * resource's own namespace now (`staff:noun`, with its own plural forms), so a
 * `grid`-bound `t` could not resolve it. The sentences are otherwise unchanged.
 */
const t = createTestI18n().t as TranslateKey;

const outcome = (over: Partial<BulkOutcome> = {}): BulkOutcome => ({
  deleted: [],
  refused: [],
  unattempted: [],
  ...over,
});

describe("summariseBulk", () => {
  it("picks the singular form for one row and the plural for more", () => {
    expect(
      summariseBulk(outcome({ deleted: ["1"] }), "staff:noun", t).headline,
    ).toBe("1 staff account deleted.");

    expect(
      summariseBulk(outcome({ deleted: ["1", "2"] }), "staff:noun", t).headline,
    ).toBe("2 staff accounts deleted.");
  });

  it("calls a clean run a success", () => {
    expect(
      summariseBulk(outcome({ deleted: ["1"] }), "users:noun", t).tone,
    ).toBe("success");
  });

  it("names each refusal, and warns rather than fails on a mixed result", () => {
    const summary = summariseBulk(
      outcome({
        deleted: ["1"],
        refused: [{ id: "2", label: "ada@example.com", message: "Refused." }],
      }),
      "staff:noun",
      t,
    );

    expect(summary.tone).toBe("warning");
    expect(summary.headline).toBe("1 deleted, 1 refused.");
    // ADR-0028's refusals are per row, so the summary has to say which row and
    // why — that is the whole return on a fan-out over a bulk endpoint.
    expect(summary.description).toBe("ada@example.com: Refused.");
  });

  it("keeps the stopped remainder a separate sentence from a refusal", () => {
    const summary = summariseBulk(
      outcome({
        deleted: ["1"],
        refused: [{ id: "2", label: "row-2", message: "Refused." }],
        unattempted: [{ id: "3", label: "row-3" }],
      }),
      "users:noun",
      t,
    );

    expect(summary.headline).toBe("1 deleted, 1 refused, 1 not attempted.");
    /*
     * "You may not" and "try again in a few minutes" have opposite remedies,
     * and collapsing them would send an operator hunting for a permission
     * problem that does not exist.
     */
    expect(summary.description).toContain("rate limiting this session");
  });

  it("calls a run that deleted nothing a failure", () => {
    expect(
      summariseBulk(
        outcome({
          refused: [{ id: "1", label: "row-1", message: "Refused." }],
        }),
        "staff:noun",
        t,
      ).tone,
    ).toBe("error");
  });
});
