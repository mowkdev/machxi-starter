import { ThemeProvider as ThemeProviderBase } from "@repo/app-services";
import type { ThemeProviderProps as ThemeProviderBaseProps } from "@repo/app-services";

import { DEVICE_KEY_PREFIX } from "@/shared/config";

/**
 * The door's one non-re-export: `@repo/app-services`' provider with this app's
 * device-key prefix bound (ADR-0064 §1).
 *
 * The same shape `shared/grid`'s door uses for `AppGrid`, and for the same
 * reason. The package takes the prefix as a parameter because it may not hold
 * a brand or an app name; binding it here rather than at each mount is what
 * keeps `ThemeProvider` meaning the same thing everywhere in this app — the
 * settings provider, the two render helpers in `src/test`, and anything added
 * later — and it puts the one line a fork edits in a file the starter's own
 * merges never touch.
 */
export type ThemeProviderProps = Omit<
  ThemeProviderBaseProps,
  "storageKeyPrefix"
>;

export const ThemeProvider = (props: ThemeProviderProps) => (
  <ThemeProviderBase {...props} storageKeyPrefix={DEVICE_KEY_PREFIX} />
);
