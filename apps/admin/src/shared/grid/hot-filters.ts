import type { Filter } from "@repo/contracts";

import { resolveOptions } from "@/shared/resource/config";
import type { HotFilterConfig } from "@/shared/resource/types";

/**
 * The hot filters' half of the URL, as pure functions (ADR-0039, `D4.4`).
 *
 * A hot filter is **a third writer of the same state, not a second mechanism**:
 * everything below turns a press into the ADR-0014 `Filter`s the same
 * `withFilters` channel carries, and derives what is pressed from the URL that
 * came back. That is what makes a hot filter and the same field's header dialog
 * two views of one entry rather than two states that can drift.
 *
 * Kept out of the component for the reason `list-state` and `column-filters`
 * are: the round trip — press, navigate, render pressed — is exactly the seam
 * where a one-directional bug survives a component test.
 */

/** The option values a group currently shows as pressed. Empty is "All". */
export const hotFilterSelection = (
  filters: readonly Filter[],
  config: Extract<HotFilterConfig, { kind: "enum" }>,
): readonly string[] => {
  const options = resolveOptions(config.options).map((option) => option.value);

  const match = filters.find(
    (filter) => filter.field === config.field && filter.op === config.op,
  );

  if (match === undefined) return [];

  const values = (Array.isArray(match.value) ? match.value : [match.value]).map(
    String,
  );

  /*
   * All-or-nothing, and that is the suppression rule's other half.
   *
   * A value the group cannot represent — a `status` outside the declared
   * options, arriving by deep link — must not be *partly* displayed: pressed
   * buttons would claim the filter is shown here while the unrepresentable part
   * of it stayed invisible. Showing nothing pressed is what hands the whole
   * entry to the chips bar, which can render anything.
   */
  return values.every((value) => options.includes(value)) ? values : [];
};

/** Whether a presence toggle is pressed. */
export const isPresenceOn = (
  filters: readonly Filter[],
  config: Extract<HotFilterConfig, { kind: "presence" }>,
): boolean =>
  filters.some(
    (filter) =>
      filter.field === config.field &&
      filter.op === "null" &&
      filter.value === config.value,
  );

/**
 * The filters a group holds after one press.
 *
 * `eq` is single-select with an implicit "All": pressing the pressed option
 * releases it, which is the whole of how a stance is cleared without a second
 * control. `in` accumulates and empties to nothing.
 */
export const toggledHotFilter = (
  config: Extract<HotFilterConfig, { kind: "enum" }>,
  selection: readonly string[],
  value: string,
): readonly Filter[] => {
  if (config.op === "eq")
    return selection.includes(value)
      ? []
      : [{ field: config.field, op: "eq", value }];

  const next = selection.includes(value)
    ? selection.filter((entry) => entry !== value)
    : [...selection, value];

  return next.length === 0
    ? []
    : [{ field: config.field, op: "in", value: next }];
};

/** The filters a presence toggle holds after one press. */
export const toggledPresence = (
  config: Extract<HotFilterConfig, { kind: "presence" }>,
  on: boolean,
): readonly Filter[] =>
  on ? [] : [{ field: config.field, op: "null", value: config.value }];

/**
 * The filter *entries* the declared hot filters are currently displaying — and
 * therefore the chips the applied-filters bar suppresses (ADR-0039).
 *
 * The invariant the bar keeps: **every applied filter is visible and removable
 * in exactly one place.** A pressed button is that filter's visible, removable
 * representation, and two removal affordances for one entry is noise. A value
 * no group can represent is displayed by nothing here, so its chip stands.
 *
 * **A set of the entries themselves, not a predicate over one.** The predicate
 * form asked "could pressing these buttons have produced this?", which is right
 * about a filter and wrong about a *list* of them: `hotFilterSelection` reads
 * the first `field:op` entry it finds, so a URL carrying `status eq active` and
 * `status eq disabled` would press "Active" and have the predicate suppress
 * both — the second entry invisible and unremovable, which is the invariant
 * failing in the code that exists to keep it. Suppressing the entry a group
 * actually read cannot say that, whatever the URL holds.
 */
export const displayedByHotFilters = (
  filters: readonly Filter[],
  hotFilters: readonly HotFilterConfig[],
): ReadonlySet<Filter> => {
  const displayed = new Set<Filter>();

  for (const config of hotFilters) {
    const match =
      config.kind === "presence"
        ? filters.find(
            (filter) =>
              filter.field === config.field &&
              filter.op === "null" &&
              filter.value === config.value,
          )
        : filters.find(
            (filter) =>
              filter.field === config.field && filter.op === config.op,
          );

    if (match === undefined) continue;
    // The same first-match entry the group renders from, and only if the group
    // can represent the whole of it.
    if (
      config.kind === "enum" &&
      hotFilterSelection([match], config).length === 0
    )
      continue;

    displayed.add(match);
  }

  return displayed;
};
