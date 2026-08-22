import { THEMES, type Theme } from "@repo/contracts";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import { useTheme } from "@/shared/theme";
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/shared/ui";

/**
 * Choosing how the panel is painted (ADR-0045 §Theme).
 *
 * A feature, because it is an interaction that changes something, and a set of
 * menu *items* rather than a menu because the shell already has one: the
 * account dropdown in the sidebar footer, which is where an operator looks for
 * a preference about themselves. Returning items keeps `widgets/app-sidebar` a
 * composition and leaves this slice free of any opinion about where it hangs.
 *
 * **The three options are the contracts tuple**, not a list written here:
 * `THEMES` is declared once and consumed by `pgEnum`, by the request body and
 * by this radio group (ADR-0023), so D7-shaped work that adds a value cannot
 * leave a control behind.
 *
 * The write itself is one call. `useTheme().setTheme` paints, writes the local
 * cache for the next first paint, and hands the account half to the coalescing
 * writer — and *this component cannot tell whether there is an account*, which
 * is what keeps the signed-out login screen's theming identical to before.
 */

const THEME_LABELS: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

const THEME_ICONS: Record<Theme, typeof SunIcon> = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
};

export const ThemeMenuItems = () => {
  const { theme, setTheme } = useTheme();

  return (
    <>
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
        Appearance
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        onValueChange={(value) => {
          /*
           * Radix hands back a `string`; the narrowing is what stops a future
           * option existing in the DOM and not in the contract. An unknown
           * value is dropped rather than sent, because the API would refuse it
           * and the refusal would be a toast about a control this app drew.
           */
          const next = THEMES.find((candidate) => candidate === value);

          if (next !== undefined) setTheme(next);
        }}
        value={theme}
      >
        {THEMES.map((option) => {
          const Icon = THEME_ICONS[option];

          return (
            <DropdownMenuRadioItem key={option} value={option}>
              <Icon className="size-4" />
              {THEME_LABELS[option]}
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
    </>
  );
};
