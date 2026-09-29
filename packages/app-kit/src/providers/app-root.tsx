import {
  PseudoNoticeProvider,
  useKeyT,
  useT,
  type DeferredTranslate,
} from "@repo/i18n";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useEffect, type ComponentType, type ReactNode } from "react";

import { AppLoader } from "../feedback/app-loader";
import {
  AppErrorBoundary,
  type ErrorBoundaryReport,
} from "../feedback/error-boundary";
import { AppUiStrings, type UiStringKeys } from "./ui-strings";

/**
 * The root's join: the providers both SPAs mount, in the one order that works
 * — moved here at `D22.1` (ADR-0077 §1).
 *
 * Both apps' `app/index.tsx` composed the same tree and differed only in
 * comments. The order is the decision, and it is stated once:
 *
 * - **The session gate** outermost. It holds a loading gate until the ADR-0033
 *   boot sequence resolves, and nothing below it renders before the store is
 *   either hydrated or known to be empty — otherwise a guard would read an
 *   empty store and bounce a signed-in person to `/login` on every reload.
 * - **`QueryClientProvider`** inside the gate, because a query fired before
 *   the session is hydrated would go out without a token, and outside the
 *   router, because ADR-0034 gives one client to the whole app.
 * - **The settings gate**, a slot. It needs the query client above it and it
 *   holds the i18next instance, so everything that resolves copy sits inside
 *   it. It is the app's because it is built out of a resource, and the kit
 *   learns no resource name.
 * - **The translation bindings**, which join the global toast handler to the
 *   instance (ADR-0046 §2): the query client is built at module scope, above
 *   the gate the instance is created inside, and a deferred lookup is what
 *   joins the two ends.
 * - **`AppUiStrings`**, a *reader* of the locale: it resolves the design
 *   system's own labels through `t` (ADR-0046 §12), so it sits inside the
 *   instance that resolves them, and above the router because a dialog's
 *   close button is chrome no route owns.
 * - **The top-level error boundary** (ADR-0062 §2), above the router and below
 *   the providers that give it copy.
 * - **`PseudoNoticeProvider`** innermost, publishing a build flag to the one
 *   layout that draws the notice.
 *
 * Both gates render the same `AppLoader`, so the two waits are one screen
 * rather than a spinner, a frame and a spinner.
 *
 * **The slots are the providers the kit does not own**: the session provider
 * is the app's binding of `createAppSession`, the settings provider is the
 * app's own, and the router arrives as `children` — the route tree is the
 * app's, and the kit learns no route name.
 */

/** A gate: it renders `fallback` until it can render `children`. */
export type AppGate = ComponentType<{
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}>;

/** The half of the app's deferred error lookup the root binds. */
export interface ErrorMessageBinding {
  readonly bind: (t: TFunction<"errors">) => void;
}

export interface AppRootProps {
  /** The app's binding of the session provider. */
  readonly session: AppGate;
  /** The app's settings gate, which mounts the i18next instance. */
  readonly settings: AppGate;
  /** Built once at module scope by the app, from its own door. */
  readonly queryClient: QueryClient;
  /** The deferred error lookup the query client was built with. */
  readonly errorMessages: ErrorMessageBinding;
  /** The deferred outcome translator the query client was built with. */
  readonly outcomes: Pick<DeferredTranslate, "bind">;
  /** The app's map from the design system's slots to its own keys. */
  readonly uiStringKeys: UiStringKeys;
  /** ADR-0066 §3's seam — `undefined` in a build with no DSN. */
  readonly report?: ErrorBoundaryReport | undefined;
  /** Whether the dev-only pseudo-locale notice shows (ADR-0048 §3). */
  readonly pseudoNotice: boolean;
  /** The app's router. */
  readonly children: ReactNode;
}

/**
 * Binds the two deferred lookups, from inside the instance.
 *
 * A component rather than a prop threaded down through the settings gate,
 * because the binding is not something that gate has an opinion about:
 * anything mounted as its child is already under the instance. Rendering
 * nothing is the whole of its output.
 */
const BindTranslations = ({
  errorMessages,
  outcomes,
}: Pick<AppRootProps, "errorMessages" | "outcomes">) => {
  const { t } = useT("errors");
  const tk = useKeyT();

  useEffect(() => {
    errorMessages.bind(t);
  }, [errorMessages, t]);

  useEffect(() => {
    outcomes.bind(tk);
  }, [outcomes, tk]);

  return null;
};

export const AppRoot = ({
  session: Session,
  settings: Settings,
  queryClient,
  errorMessages,
  outcomes,
  uiStringKeys,
  report,
  pseudoNotice,
  children,
}: AppRootProps) => (
  <Session fallback={<AppLoader />}>
    <QueryClientProvider client={queryClient}>
      <Settings fallback={<AppLoader />}>
        <BindTranslations errorMessages={errorMessages} outcomes={outcomes} />
        <AppUiStrings keys={uiStringKeys}>
          <AppErrorBoundary report={report}>
            <PseudoNoticeProvider enabled={pseudoNotice}>
              {children}
            </PseudoNoticeProvider>
          </AppErrorBoundary>
        </AppUiStrings>
      </Settings>
    </QueryClientProvider>
  </Session>
);
