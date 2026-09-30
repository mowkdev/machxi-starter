import { Spinner } from "@repo/ui/components/spinner";
import { useContext, useEffect, useState } from "react";
import { I18nContext } from "react-i18next";

/**
 * The whole-window loader the boot gates render (ADR-0033's session gate,
 * ADR-0045's settings gate) — extracted at `D14.8` (ADR-0062 §1).
 *
 * **It reads the i18n context instead of the hook**, and that is the point of
 * the file: it is mounted *above* the i18n provider as often as below it, so
 * `useT` would throw where this degrades. `I18nContext` is `null` before an
 * instance exists, and the English default below is what a browser sees for
 * the few hundred milliseconds a cold refresh takes.
 *
 * The key it reads is `common:loading.starting`, which is a key no scan of an
 * app's `src/` can see: both apps name it in their drift check's `DYNAMIC`
 * list for the reason ADR-0046 §9's list exists (ADR-0062 §1).
 *
 * **The delay is the loader's whole reason to be careful.** A spinner that
 * appears for 80 ms reads as a flash of broken layout, so nothing is painted
 * for `delayMs` — but a *blank* is painted, at the app's background colour, so
 * the window does not flash white on a dark theme before React has an opinion.
 *
 * **The delay runs once per page load** (`D31.3`, ADR-0080 §5). It is counted
 * from the moment the document started loading, `performance.now()`'s own
 * origin, rather than from this component's mount. The two boot gates run in
 * sequence, the session's and then the settings', and each used to wait its
 * own quarter-second, so a slow boot read as a blank, a spinner, a blank and a
 * spinner. Counted from the page, the second gate finds the delay spent and
 * shows the loader at once, so the two waits read as one. `index.html`'s static
 * indicator keeps the same quarter-second, so the markup the first render
 * replaces and the loader that replaces it appear together.
 */
const STARTING_KEY = "loading.starting";

/** The last-resort sentence, for the render before any catalogue is mounted. */
const STARTING_FALLBACK = "Starting…";

export interface AppLoaderProps {
  /** `0` renders immediately — what a test wants and a boot gate does not. */
  readonly delayMs?: number;
  /** An explicit sentence, for a caller that already has one translated. */
  readonly label?: string;
}

/** Milliseconds since this document started loading: the delay's clock. */
const sincePageLoad = (): number => performance.now();

export const AppLoader = ({ delayMs = 250, label }: AppLoaderProps) => {
  const context = useContext(I18nContext);
  const [visible, setVisible] = useState(() => sincePageLoad() >= delayMs);

  useEffect(() => {
    if (visible) return;

    const timer = setTimeout(
      () => {
        setVisible(true);
      },
      Math.max(0, delayMs - sincePageLoad()),
    );

    return () => {
      clearTimeout(timer);
    };
  }, [delayMs, visible]);

  if (!visible) return <div className="min-h-svh bg-background" />;

  return (
    <div
      aria-live="polite"
      className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background"
      role="status"
    >
      {/*
       * The `role`/`aria-label` the primitive sets are stripped: the region
       * above is already the live status, and a nested status with its own
       * label is a second announcement of the same event.
       */}
      <Spinner
        aria-hidden="true"
        aria-label={undefined}
        className="size-6 text-muted-foreground motion-reduce:animate-none"
        role={undefined}
      />
      <span className="text-sm text-muted-foreground">
        {label ?? context?.i18n.t(STARTING_KEY) ?? STARTING_FALLBACK}
      </span>
    </div>
  );
};
