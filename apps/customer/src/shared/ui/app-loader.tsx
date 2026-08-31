import { useContext, useEffect, useState } from "react";
import { I18nContext } from "react-i18next";

import { Spinner } from "@repo/ui/components/spinner";

import { EN_RESOURCES } from "@/shared/i18n";

/**
 * The screen the app shows while it is starting (ADR-0033 §Boot).
 *
 * A component of its own rather than a re-export, which is what `shared/ui`'s
 * index reserves this directory for: it has behaviour, and the behaviour is the
 * point.
 *
 * **It waits before it appears.** A boot against a local API settles in tens of
 * milliseconds, and a spinner that flashes for one frame reads as a glitch
 * rather than as progress. So nothing is drawn for `delayMs`, and the spinner
 * appears only if the wait is long enough to be worth explaining. The trade is
 * worth naming: a hung boot now *looks* hung, where a deliberately blank
 * fallback is indistinguishable from a broken app — which is the ambiguity that
 * once made a boot latch that never resolved cost a debugging session rather
 * than a glance.
 *
 * The ground is painted from the first frame either way, so the app does not
 * flash white before the spinner or before the first real screen.
 */
export const AppLoader = ({
  delayMs = 250,
  label,
}: {
  /** How long to wait before drawing anything. `0` draws immediately. */
  delayMs?: number;
  /** Overrides the default, which is the app's own "Starting…" from `common`. */
  label?: string;
}) => {
  /*
   * **The one screen that renders before i18next exists.**
   *
   * It is the boot gate's fallback, and the gate sits above `I18nProvider`
   * (`app/index.tsx`). So there is no instance to ask when this first paints,
   * and `useTranslation` outside a provider does not degrade — it warns and
   * hands back the key, so a customer would read `loading.starting` while the
   * app started.
   *
   * The context is therefore read rather than the hook called, and the answer
   * degrades to the eagerly bundled `en` — the fallback locale (ADR-0046 §3)
   * and the only catalogue that could be in memory this early anyway, every
   * other one being a dynamic `import()` nothing has asked for yet. The key
   * stays a key, so `scripts/i18n.mjs` still finds it.
   */
  const context = useContext(I18nContext);
  const [visible, setVisible] = useState(delayMs === 0);

  useEffect(() => {
    if (delayMs === 0) return;

    const timer = setTimeout(() => {
      setVisible(true);
    }, delayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [delayMs]);

  if (!visible) return <div className="min-h-svh bg-background" />;

  return (
    <div
      aria-live="polite"
      className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background"
      role="status"
    >
      {/*
       * Decorative here: the wrapper is the live region and the label below is
       * what a screen reader should read, so the icon's own `role="status"` and
       * "Loading" name would announce the same thing twice.
       *
       * `motion-reduce:animate-none` because someone who asked the platform for
       * less motion asked this too.
       */}
      <Spinner
        aria-hidden="true"
        aria-label={undefined}
        className="size-6 text-muted-foreground motion-reduce:animate-none"
        role={undefined}
      />
      <span className="text-sm text-muted-foreground">
        {label ??
          context?.i18n.t("loading.starting") ??
          EN_RESOURCES.common.loading.starting}
      </span>
    </div>
  );
};
