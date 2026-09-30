import { useT } from "@repo/i18n";
import { Spinner } from "@repo/ui/components/spinner";
import type { ReactNode } from "react";

/**
 * The router's default pending component, and when it may appear (`D31.3`,
 * ADR-0080 §5, a delta on ADR-0052's rejected "pending route component").
 *
 * **The shell's indicator still owns the first moments of a navigation.**
 * ADR-0052 rejected a pending component because it swaps the old screen for a
 * flash of placeholder on every click, and that objection stands. So this one
 * appears only after {@link PENDING_MS}: a route whose chunk or loader has
 * outlasted the threshold is a real wait, and a blank outlet for it says less
 * than a sentence does. Once shown it holds for {@link PENDING_MIN_MS}, so a
 * wait that ends just after the threshold does not flicker.
 *
 * **Both numbers are measured, not chosen.** They start at the router's own
 * defaults, on the operator's decision when D31 opened. On the dev stack, which
 * is slower than a production build, the longest router-pending window the
 * shell's indicator covered in a walk of both apps was about 220 ms, on a
 * record route's detail loader, and a sidebar navigation was under 160 ms. The
 * threshold sits more than four times above that, so an ordinary navigation
 * never reaches it. `docs/plan/0031-interface-polish.notes.md` (`D31.3`) holds
 * the method and every figure.
 *
 * The kit learns no router: the component is plain React and the two numbers
 * are values, which each app's `createRouter` call takes as
 * `defaultPendingComponent`, `defaultPendingMs` and `defaultPendingMinMs`.
 *
 * The sentence is `common:loading.pending`, which no scan of an app's `src/`
 * can see: both apps name it in their drift check's `DYNAMIC` list, beside
 * `loading.starting`. It renders inside the router and so inside the i18n
 * provider, unlike `AppLoader`, which is why `useT` is safe here.
 */

/** How long a navigation may run before the pending state replaces it. */
export const PENDING_MS = 1000;

/** How long the pending state holds once shown. */
export const PENDING_MIN_MS = 500;

const PENDING_KEY = "loading.pending";

export const AppPending = (): ReactNode => {
  const { t } = useT("common");

  return (
    <div
      aria-live="polite"
      className="flex min-h-40 flex-1 flex-col items-center justify-center gap-3 p-6"
      data-slot="app-pending"
      role="status"
    >
      {/*
       * The primitive's own `role` and `aria-label` are stripped, as in
       * `AppLoader`: this region is the live status, and a nested one with its
       * own label would announce the same wait twice.
       */}
      <Spinner
        aria-hidden="true"
        aria-label={undefined}
        className="size-6 text-muted-foreground motion-reduce:animate-none"
        role={undefined}
      />
      <span className="text-sm text-muted-foreground">{t(PENDING_KEY)}</span>
    </div>
  );
};
