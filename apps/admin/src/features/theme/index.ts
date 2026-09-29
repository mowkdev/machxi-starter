/**
 * Choosing how the app is painted — a door onto `@repo/account` since `D22.2` (ADR-0077 §2–§3).
 *
 * The card is the package's. What this slice binds is the control it draws
 * with: `SettingsOptions` is `@repo/app-kit`'s, which the account package may
 * not depend on, so it arrives through this app's own `shared/ui` door.
 */
import { createThemeCards } from "@repo/account";

import { SettingsOptions } from "@/shared/ui";

export const ThemeCards = createThemeCards(SettingsOptions);
