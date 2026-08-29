import type { Filter } from "@repo/contracts";

import { optionValues } from "@repo/resource";
import type { HotFilterConfig } from "@repo/resource";

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
  const options = optionValues(config.options);

  const match = filters.find(
    (filter) => filter.field === config.field && filter.op === config.op,
  );

  if (match === undefined) return [];

  const values = (Array.isArray(match.value) ? match.value : [match.value]).map(
    String,
  );

  /*
   * All-or-nothing, because a pressed button is a claim about the whole entry.
   *
   * A value the group cannot represent — a `status` outside the declared
   * options, arriving by deep link — must not be *partly* displayed: pressed
   * buttons would say the filter is this group's while the unrepresentable
   * part of it went unmentioned, and pressing one again would rewrite the
   * entry to something the operator never asked for. Nothing pressed is the
   * honest answer, and the chip in the applied-filters bar — which since
   * `D10.2` renders for every filter, representable or not — is what says
   * what the list is actually filtered by.
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

/*
 * `displayedByHotFilters` stood here until `D10.2` and is gone with the rule it
 * served: ADR-0052 retires ADR-0039's chip suppression, so the applied-filters
 * bar no longer asks which entries a group is displaying. Deleted rather than
 * left exported — a function with no consumer is a claim nothing checks, and
 * its whole subject was a decision that has been reversed.
 */
