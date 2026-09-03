import { useKeyT, type TranslationKey } from "@repo/i18n";
import { UiStringsProvider, type UiStrings } from "@repo/ui/ui-strings";
import { useMemo, type ReactNode } from "react";

/**
 * The `UiStrings` seam of ADR-0046 §12, filled from the app's catalogue —
 * extracted at `D14.8` (ADR-0062 §1).
 *
 * **The keys stay in the app and only the wiring moves.** ADR-0046 §11 keeps
 * the dictionary per app, and the two apps do not fill the same slots: the
 * admin translates fifteen because it renders a paginated grid and a
 * breadcrumb trail, the customer six. So the map is the app's data and this
 * component is the loop over it.
 *
 * `useKeyT` rather than `useT("common")`: a slot's key arrives as a value
 * rather than as a literal at the call site, so it is typed as the whole
 * program's `TranslationKey` — namespace prefix and all — and the app writes
 * `"common:ui.close"`. That keeps the compiler checking every key against the
 * app's catalogues (ADR-0046 §13) and keeps the literal inside `src/`, where
 * the drift check can see it (ADR-0046 §9).
 */
export type UiStringKeys = Readonly<
  Partial<Record<keyof UiStrings, TranslationKey>>
>;

export interface AppUiStringsProps {
  readonly keys: UiStringKeys;
  readonly children: ReactNode;
}

export const AppUiStrings = ({ keys, children }: AppUiStringsProps) => {
  const t = useKeyT();

  const strings = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(keys).map(([slot, key]) => [slot, t(key)]),
      ) as Partial<UiStrings>,
    [keys, t],
  );

  return <UiStringsProvider strings={strings}>{children}</UiStringsProvider>;
};
