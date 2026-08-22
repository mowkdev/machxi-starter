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
 * rather than as progress — the well-known cure is worse than the disease. So
 * nothing is drawn for `delayMs`, and the spinner appears only if the wait is
 * long enough to be worth explaining.
 *
 * The trade that buys is the one worth naming: a hung boot now *looks* hung,
 * where D3.4's deliberately blank fallback was indistinguishable from a broken
 * app. That ambiguity is what made a real bug — a boot latch that never
 * resolved — take a debugging session rather than a glance.
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
  /**
   * Overrides the default, which is the app's own "Starting…" from `common`.
   *
   * A default parameter cannot call a hook, so the fallback moved into the body
   * (`D7.2`). A caller with words of its own still passes them; the point of
   * the prop is that a boot screen for something other than the app can say so.
   */
  label?: string;
}) => {
  /*
   * **The one screen that renders before i18next exists** (`D7.2`).
   *
   * It is the boot gate's fallback and the settings gate's, and both sit above
   * `I18nProvider` — which is mounted *inside* `SettingsProvider`, where the
   * account's locale is already known (`D7.1`, ADR-0046 §4). So there is no
   * instance to ask when this first paints, and `useTranslation` outside a
   * provider does not degrade, it warns and hands back the key: the operator
   * would read `loading.starting` while the app started.
   *
   * The context is therefore read rather than the hook called, and the answer
   * degrades to the eagerly bundled `en` — which is the fallback locale
   * (ADR-0046 §3) and the only catalogue that could be in memory this early
   * anyway, every other one being a dynamic `import()` that has not been asked
   * for yet. The key stays a key, so the extractor of `D7.6` still finds it.
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
       * `motion-reduce:animate-none` because an operator who asked the platform
       * for less motion asked this too.
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
