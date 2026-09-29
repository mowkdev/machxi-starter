import type { Filter } from "@repo/contracts";
import { activeIntlTag } from "@repo/i18n";
import { mergeColumns } from "@repo/resource";
import { describe, expect, it } from "vitest";

import { chipsForState } from "../filter-chips";
import { createTranslator } from "./support/demo-i18n";
import { demoResourceConfig } from "./support/demo-resource";

/**
 * The applied-filters bar's contents, as data (ADR-0039, `D4.4`).
 *
 * The property under test is the one the whole surface rests on: **every
 * applied filter produces a chip, whether or not a column claims it**. A
 * summary derived from the configs would omit exactly the case the bar exists
 * for — a filter that reached the server through a deep link and narrowed the
 * list with nothing on screen admitting it.
 *
 * The configs are here for their *words* only, which is why the negative cases
 * below matter as much as the positive ones: an unowned field, an operator the
 * column's config does not describe, and a presence value that is the opposite
 * of the declared one all fall through to the raw rendering rather than
 * borrowing a label that would misdescribe them.
 */

const columns = mergeColumns(demoResourceConfig.columns);

/**
 * The real `en` catalogue, not a stub (`D7.2`).
 *
 * `labelFor` composes its sentences from `grid:chip.*` now, so a table that
 * translated through a fake would prove the composition and not the copy — and
 * a key deleted from the catalogue would still pass. Building the instance the
 * app builds is what keeps these assertions the operator's words.
 *
 * **App-wide rather than `grid`-bound since `D7.4`**: half of a chip's words
 * are the column's — its header, an enum option, a `presence` label — and those
 * are keys in the resource's namespace (here the fixture's `demo:`).
 *
 * **The package's own instance since `D22.3`** (ADR-0077 §4): the grid's
 * catalogue, the fixture's and the `common:options` slice an enum reads — the
 * three things these labels were ever composed from.
 */
const t = createTranslator();

const labels = (filters: readonly Filter[]): readonly string[] =>
  chipsForState(filters, columns, t).map((chip) => chip.label);

/**
 * The day a range bound names, formatted the one way that agrees with the
 * dialog.
 *
 * The **timezone** is what these assertions pin, not the locale — but the
 * locale had to be named at `D7.2`, because it stopped being the runner's.
 * `undefined` meant "the machine's language", and the app now formats through
 * `INTL_TAGS`, so a runner set to `en-US` would have read `Aug 12, 2026` while
 * the chip said `12 Aug 2026`. `activeIntlTag()` is the app's own answer, so
 * the assertion follows the decision rather than restating it. Timezone is the
 * part that was wrong: a bound is
 * UTC midnight or UTC end-of-day of the day the operator picked, the dialog
 * re-reads it with `toISOString().slice(0, 10)`, and formatting the same
 * instant in the operator's own zone moved an end-of-day bound forward a day
 * east of UTC and a start-of-day bound back a day west of it — the chip and the
 * dialog naming different days for one filter. The first version of this test
 * asserted through the app's own local formatter and therefore agreed with
 * itself no matter what.
 */
const utcDay = (instant: string): string =>
  new Intl.DateTimeFormat(activeIntlTag(), {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(instant));

describe("chipsForState", () => {
  it("gives one chip per applied filter, in the order the URL holds them", () => {
    const filters: readonly Filter[] = [
      { field: "name", op: "like", value: "%ada%" },
      { field: "status", op: "eq", value: "active" },
    ];

    expect(chipsForState(filters, columns, t)).toHaveLength(2);
    expect(chipsForState(filters, columns, t).map((chip) => chip.key)).toEqual([
      "name:like",
      "status:eq",
    ]);
    // The chip carries the filter itself, so removing it removes exactly what
    // the label described — no re-derivation, nothing to get out of step.
    expect(chipsForState(filters, columns, t)[0]?.filter).toBe(filters[0]);
  });

  it("says a `like` filter in the words that were typed, not the wire's", () => {
    // `%ada%` is the pattern the client wrote on the operator's behalf; showing
    // it back would be the UI reading its own plumbing aloud.
    expect(labels([{ field: "name", op: "like", value: "%ada%" }])).toEqual([
      "Name contains “ada”",
    ]);
  });

  it("resolves an enum value through the column's own options", () => {
    expect(labels([{ field: "status", op: "eq", value: "active" }])).toEqual([
      "Status is Active",
    ]);
  });

  it("names each bound of a range separately", () => {
    /*
     * Two chips, because the URL holds two entries and each is independently
     * removable — an operator loosening the lower bound should not have to
     * re-enter the upper one.
     */
    expect(
      labels([
        {
          field: "createdAt",
          op: "gte",
          value: new Date("2026-01-15T00:00:00.000Z"),
        },
        {
          field: "createdAt",
          op: "lte",
          value: new Date("2026-02-20T00:00:00.000Z"),
        },
      ]),
    ).toEqual([
      `Created from ${utcDay("2026-01-15T00:00:00.000Z")}`,
      `Created to ${utcDay("2026-02-20T00:00:00.000Z")}`,
    ]);
  });

  it("names an end-of-day bound as the day that was picked, in any timezone", () => {
    /*
     * The bound `toListFilters` actually writes for "up to 20 Feb": the last
     * instant of that UTC day. West of UTC a local formatter would still say
     * the 20th; east of it, the 21st — and the dialog would still be showing
     * the 20th.
     */
    expect(
      labels([
        {
          field: "createdAt",
          op: "lte",
          value: new Date("2026-02-20T23:59:59.999Z"),
        },
      ]),
    ).toEqual([`Created to ${utcDay("2026-02-20T00:00:00.000Z")}`]);
  });

  it("uses a presence filter's own label, which is the one no schema can check", () => {
    // "Show archived", not "archivedAt is false" — the demo's label, and the
    // real one is the users grid's "Deleted only", where getting the words
    // wrong would describe the opposite scope.
    expect(labels([{ field: "archivedAt", op: "null", value: false }])).toEqual(
      ["Show archived"],
    );
  });

  it("falls back to a raw rendering for a filter no column owns", () => {
    /*
     * The case the bar exists for. `ownerId` is not a column, so no config can
     * phrase it — and the answer is an ugly chip rather than no chip, because
     * the alternative is a list that is quietly narrower than its UI admits.
     */
    expect(labels([{ field: "ownerId", op: "eq", value: "u-9" }])).toEqual([
      "ownerId eq u-9",
    ]);
  });

  it("falls back where the column's config cannot describe the operator", () => {
    /*
     * `name` declares a `like` control; a deep-linked `eq` on the same field is
     * a different question, and lending it the column's phrasing would be the
     * config claiming knowledge it does not have. The header is still not used,
     * on purpose — the raw form is the visible admission.
     */
    expect(labels([{ field: "name", op: "eq", value: "Sprocket" }])).toEqual([
      "name eq Sprocket",
    ]);
  });

  it("falls back where a presence filter carries the opposite value", () => {
    // The config writes `null: false` ("show archived"); `null: true` is the
    // other scope entirely, and "Show archived" would be a lie about it.
    expect(labels([{ field: "archivedAt", op: "null", value: true }])).toEqual([
      "archivedAt null true",
    ]);
  });

  it("refuses to say “contains” about a pattern this app did not write", () => {
    /*
     * `unescapeContains` is exact for what `containsPattern` produces and a
     * guess for anything else, so the term is round-tripped before it is
     * trusted. A deep link carrying an unwrapped `like` asks the server for an
     * *exact* match; calling that "contains" over an empty grid would let an
     * operator conclude the substring is missing rather than that they asked a
     * different question.
     */
    expect(labels([{ field: "name", op: "like", value: "ada" }])).toEqual([
      "name like ada",
    ]);
    // And the other direction: a real wildcard shown as a literal `%`.
    expect(labels([{ field: "name", op: "like", value: "%a%b%" }])).toEqual([
      "name like %a%b%",
    ]);
    // What this app writes still round-trips, escaping included.
    expect(labels([{ field: "name", op: "like", value: "%100\\%%" }])).toEqual([
      "Name contains “100%”",
    ]);
  });

  it("bounds a label the URL wrote", () => {
    /*
     * `filterSchema` bounds neither `field` nor a scalar `value`, which was
     * harmless while nothing rendered a filter no column owned. A link carrying
     * a 100 KB field name would otherwise wrap into a band that eats ADR-0037's
     * whole height budget and pushes the table and pager off screen.
     */
    const [chip] = chipsForState(
      [{ field: "x".repeat(5_000), op: "eq", value: "y" }],
      columns,
      t,
    );

    expect(chip?.label.length).toBeLessThanOrEqual(81);
    expect(chip?.label.endsWith("…")).toBe(true);
    // Still removable, and still the whole filter it names.
    expect(chip?.filter.field).toHaveLength(5_000);
  });

  it("keys a repeated field and operator apart, so both chips render", () => {
    /*
     * Field + op is the filter's identity and is not unique across a
     * hand-written URL. React needs a key that is; the first occurrence keeps
     * the bare form every ordinary URL sees.
     */
    expect(
      chipsForState(
        [
          { field: "status", op: "eq", value: "active" },
          { field: "status", op: "eq", value: "disabled" },
        ],
        columns,
        t,
      ).map((chip) => chip.key),
    ).toEqual(["status:eq", "status:eq#1"]);
  });

  it("renders a list value as a list", () => {
    expect(
      labels([{ field: "ownerId", op: "in", value: ["u-1", "u-2"] }]),
    ).toEqual(["ownerId in u-1, u-2"]);
  });
});
