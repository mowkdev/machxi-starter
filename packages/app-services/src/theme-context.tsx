import type { Theme } from "@repo/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { applyTheme, preferredTheme, resolveTheme } from "./theme";

/**
 * The theme, bound to React (ADR-0045 §Theme).
 *
 * It lives in `shared` rather than beside the provider that configures it, for
 * the reason `useApiClient` does (ADR-0032): the control that toggles the theme
 * is a feature and the shell that hosts it is a widget, and neither may import
 * from `app`. `app/providers/settings.tsx` is what renders this and what
 * connects it to an account — exactly the relationship `ApiProvider` has with
 * `app/providers/session.tsx`.
 *
 * Three facts about the same preference meet here and the order matters:
 *
 * 1. **The local cache paints first.** `main.tsx` applied it before React
 *    existed, so this starts from the same value rather than from a default
 *    that would flash.
 * 2. **The account wins when it arrives.** `adopted` is the settings query's
 *    answer; it is applied once per distinct value, so adopting cannot fight
 *    an operator who toggles afterwards.
 * 3. **A toggle writes both.** The cache synchronously, so the next first paint
 *    is right even offline, and the account through `publish` — the debounced,
 *    coalescing writer, which is why this component knows nothing of requests.
 */

export interface ThemeView {
  /** What the operator chose. `"system"` is a choice, not the absence of one. */
  readonly theme: Theme;
  readonly setTheme: (theme: Theme) => void;
}

/**
 * No default value, so `useTheme` outside a provider is a loud failure rather
 * than a control that silently toggles nothing. Both render helpers in the
 * test harness mount one for the same reason the app does.
 */
const ThemeContext = createContext<ThemeView | null>(null);

export interface ThemeProviderProps {
  readonly children: ReactNode;
  /**
   * The account's theme, once `GET /settings` has answered. `undefined` while
   * the app is anonymous or the read failed — which is the local-only app this
   * panel was before ADR-0045, unchanged.
   */
  readonly adopted?: Theme | undefined;
  /**
   * Where a toggle also goes when there is an account to remember it.
   * `undefined` signed out: the cache is then the only owner.
   */
  readonly publish?: ((theme: Theme) => void) | undefined;
}

export const ThemeProvider = ({
  children,
  adopted,
  publish,
}: ThemeProviderProps) => {
  const [theme, setThemeState] = useState<Theme>(preferredTheme);

  /*
   * The adoption latch. Without it, the effect would re-apply the server's
   * value on every render whose `theme` differs from it — which is every
   * render after the operator toggles, so a toggle would spring back to the
   * account's last saved value before the write that changes it lands.
   */
  const lastAdopted = useRef<Theme | null>(null);

  useEffect(() => {
    if (adopted === undefined || adopted === lastAdopted.current) return;

    lastAdopted.current = adopted;
    setThemeState(adopted);
    applyTheme(adopted);
  }, [adopted]);

  /*
   * `"system"` is a live deferral, not a snapshot: an operator who has chosen
   * it and then flips their OS to dark expects the panel to follow without a
   * reload. The subscription exists only while that is the choice, so a
   * `light` or `dark` panel is not listening to anything.
   */
  useEffect(() => {
    if (theme !== "system") return;

    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyTheme("system");
    };

    query.addEventListener("change", onChange);

    return () => {
      query.removeEventListener("change", onChange);
    };
  }, [theme]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      // The cache first and unconditionally: it is what the next first paint
      // reads, and it must be right whether or not there is an account.
      applyTheme(next);
      publish?.(next);
    },
    [publish],
  );

  const value = useMemo<ThemeView>(
    () => ({ theme, setTheme }),
    [theme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeView => {
  const value = useContext(ThemeContext);

  if (value === null) {
    throw new Error("useTheme must be used within a <ThemeProvider>");
  }

  return value;
};

export { resolveTheme };
