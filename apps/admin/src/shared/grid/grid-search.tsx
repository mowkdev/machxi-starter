import { useEffect, useState, type ComponentProps } from "react";

import { useT } from "@/shared/i18n";
import { Input } from "@/shared/ui";

/**
 * The toolbar's free-text search — ADR-0014's `q`, where the endpoint declares
 * itself searchable.
 *
 * It is not a column filter: `q` searches whatever columns the *endpoint* says
 * it does, which is a property of the API rather than of any one column, so it
 * lives above the table rather than under a header (ADR-0035, amended D3.6).
 *
 * **It is also the only debounced control left** (`D4.4`). The filter row's
 * per-keystroke debounce moved here with it, because the four filter kinds now
 * live inside a dialog that commits on Apply and a debounce inside a
 * commit-on-Apply surface is machinery with nothing to do (ADR-0039). Search
 * still live-commits — an operator typing a term wants the list narrowing under
 * them — so it still needs the trick, and the trick is now visibly one control's
 * rather than something the grid does generally.
 */

const DEBOUNCE_MS = 300;

/**
 * A text box that navigates when the operator stops typing.
 *
 * Undebounced, every keystroke would be a navigation, a new query key and a
 * request — five for `ada@x`, four of them already stale on arrival. Local
 * state holds what is typed; the sync below re-seeds it when the value changes
 * from outside (the back button, a pasted link), which is the case a plain
 * `defaultValue` gets wrong.
 */
const DebouncedInput = ({
  value,
  onCommit,
  ...props
}: {
  readonly value: string;
  readonly onCommit: (next: string) => void;
} & Omit<ComponentProps<typeof Input>, "value" | "onChange">) => {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);

  /*
   * Re-syncing the draft when the value changes from outside — the back button,
   * a pasted link, a Clear all — adjusted **during render** rather than in an
   * effect.
   *
   * This is React's own documented pattern for "a prop changed and some state
   * has to follow it": the component re-renders immediately with the new value
   * and nothing in between is ever painted, where an effect would render the
   * stale draft first and then render again. `set-state-in-effect` flags the
   * effect version for exactly that reason.
   */
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }

  useEffect(() => {
    if (draft === value) return;

    const timer = setTimeout(() => {
      onCommit(draft);
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
    // `onCommit` is re-created per render by every caller; including it would
    // restart the timer on each keystroke's re-render and never fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, value]);

  return (
    <Input
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      {...props}
    />
  );
};

export const GridSearch = ({
  value,
  onCommit,
}: {
  readonly value: string;
  readonly onCommit: (next: string) => void;
}) => {
  const { t } = useT("grid");

  return (
    <DebouncedInput
      type="search"
      aria-label={t("search.label")}
      placeholder={t("search.placeholder")}
      className="h-8 max-w-xs"
      value={value}
      onCommit={onCommit}
    />
  );
};
