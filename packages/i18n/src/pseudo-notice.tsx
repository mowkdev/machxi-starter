import { createContext, useContext, type ReactNode } from "react";

/**
 * Whether the dev-only pseudo-locale notice shows (ADR-0048 §3, `D8.7`).
 *
 * It lives in `shared` rather than beside the provider that configures it, for
 * the reason `useTheme` does (ADR-0049): the `_dashboard` route file reads it
 * and `app/providers` mounts it, and nothing below `app` may import from
 * `app`.
 *
 * **Why a context at all, rather than reading `config.VITE_I18N_PSEUDO` where
 * the notice renders.** The admin's vitest config pins that variable to
 * `"false"` for the whole suite on purpose, so a notice gated on it directly
 * would render in no test in this repository — the unexercised-surface defect
 * this deliverable has already recorded twice about the `page` edit surface.
 * A context has a seam a test can drive.
 *
 * **And why not `renderApp`'s existing `pseudo` option.** That one selects the
 * pseudo-locale *lens* and reaches only `createI18n`; reusing it would mount
 * this notice on all nine routes of ADR-0046 §14's pseudo-locale walk, whose
 * copy would then have to survive `unaccented()`. The router context was the
 * other candidate and is ruled out by ADR-0048 §3: it is exactly
 * `{session, queryClient, client}`, which no record in this deliverable may
 * widen.
 *
 * Defaulting to `false` rather than throwing outside a provider is the
 * opposite of `useTheme`'s rule, deliberately: a missing theme provider is a
 * control that silently toggles nothing, while a missing notice provider is
 * simply a build with the notice off — which is every production build.
 */
const PseudoNoticeContext = createContext(false);

export interface PseudoNoticeProviderProps {
  readonly children: ReactNode;
  /** The app passes `config.VITE_I18N_PSEUDO`; a test passes what it needs. */
  readonly enabled: boolean;
}

export const PseudoNoticeProvider = ({
  children,
  enabled,
}: PseudoNoticeProviderProps) => (
  <PseudoNoticeContext.Provider value={enabled}>
    {children}
  </PseudoNoticeContext.Provider>
);

export const usePseudoNotice = (): boolean => useContext(PseudoNoticeContext);
