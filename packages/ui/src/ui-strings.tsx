"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * The six strings the generated primitives say out loud (ADR-0046 §12).
 *
 * **The design system gains no i18n dependency.** It is a package of owned
 * shadcn source (ADR-0031) that two apps on two bundlers compile directly, and
 * a translation library in here would be a runtime every consumer inherits and
 * a locale every consumer has to agree on. What it gains instead is the
 * smallest seam that solves the problem: six injectable strings with English
 * defaults, and no opinion whatever about where a translation comes from.
 *
 * Why these six and not "every literal in the package": these are the ones a
 * *person* reads. Four of them are `sr-only` spans or `aria-label`s, which is
 * the audience a visual walk never notices — a Latvian operator's screen
 * reader announcing `Close` and `Toggle Sidebar` is exactly the failure
 * ADR-0046 §Alternatives rejected leaving in place. `data-slot`, `role` and the
 * landmark names beside them are identifiers, not sentences.
 *
 * This file is **hand-written, not generated**: prettier applies to it, it
 * lives outside `src/components/`, and it is therefore not part of ADR-0031's
 * regenerate-and-diff surface. The six edits in the generated files that read
 * from it are, and each one carries a comment saying so.
 */
export interface UiStrings {
  /** `dialog.tsx` — the corner close button's `sr-only` label and the footer's optional close action. `sheet.tsx` — the same corner button. */
  readonly close: string;
  /** `pagination.tsx` — `PaginationPrevious`'s visible label. */
  readonly previous: string;
  /** `pagination.tsx` — `PaginationNext`'s visible label. */
  readonly next: string;
  /** `pagination.tsx` — `PaginationEllipsis`'s `sr-only` label. */
  readonly morePages: string;
  /** `breadcrumb.tsx` — `BreadcrumbEllipsis`'s `sr-only` label. */
  readonly more: string;
  /** `sidebar.tsx` — the trigger's `sr-only` label and the rail's `aria-label`/`title`. */
  readonly toggleSidebar: string;
}

/**
 * English, and the source language (ADR-0046 §5: `en` means en-GB).
 *
 * These are the literals the shadcn CLI emits, moved rather than rewritten —
 * so a consumer that mounts no provider renders exactly what it rendered
 * before this file existed. That is what keeps this package's own suite, and
 * any future app that has not localised yet, unaffected.
 */
export const DEFAULT_UI_STRINGS: UiStrings = {
  close: "Close",
  previous: "Previous",
  next: "Next",
  morePages: "More pages",
  more: "More",
  toggleSidebar: "Toggle Sidebar",
};

/**
 * `null` rather than the defaults, so {@link useUiStrings} can tell "no
 * provider" from "a provider that supplied nothing" without either being an
 * error. Both answer with English; only one of them is a mistake, and neither
 * should throw at a screen reader's expense.
 */
const UiStringsContext = createContext<UiStrings | null>(null);

export interface UiStringsProviderProps {
  /**
   * Whatever the app has a translation for. Partial on purpose: an app that
   * localises four of the six is not broken, it is halfway, and the other two
   * keep their English until it finishes.
   */
  readonly strings?: Partial<UiStrings>;
  readonly children: ReactNode;
}

/**
 * Supplies the six from above the tree.
 *
 * The value is memoised **on the six strings themselves**, not on the object
 * they arrive in, which is the difference between a design-system seam and a
 * trap: the app's natural call site is a component that rebuilds the object on
 * every render (`{ close: t("common:ui.close"), … }`), and memoising on that
 * object would push a new context value — and a re-render of every dialog,
 * sheet, pager and sidebar in the app — through every unrelated render. Doing
 * it here means no caller has to know.
 */
export const UiStringsProvider = ({
  strings,
  children,
}: UiStringsProviderProps) => {
  const { close, previous, next, morePages, more, toggleSidebar } = {
    ...DEFAULT_UI_STRINGS,
    ...strings,
  };

  const value = useMemo<UiStrings>(
    () => ({ close, previous, next, morePages, more, toggleSidebar }),
    [close, previous, next, morePages, more, toggleSidebar],
  );

  return (
    <UiStringsContext.Provider value={value}>
      {children}
    </UiStringsContext.Provider>
  );
};

/**
 * The primitives' side of the seam. Falls back to {@link DEFAULT_UI_STRINGS}
 * with no provider mounted, so nothing in this package depends on an app
 * having done anything.
 */
export const useUiStrings = (): UiStrings =>
  useContext(UiStringsContext) ?? DEFAULT_UI_STRINGS;
