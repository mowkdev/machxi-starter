import type { UiStringKeys } from "@repo/app-kit";

/**
 * Which `UiStrings` slot this app fills, and from which key (ADR-0046 §12).
 *
 * The `UiStrings` seam lets `@repo/ui` ship copy-free primitives: a slot is
 * either filled by the app that mounts them or falls back to the package's
 * English default. `@repo/app-kit`'s `AppUiStrings` is the loop over this map
 * — the map itself stays here, because ADR-0046 §11 keeps the dictionary per
 * app and the two apps do not render the same primitives.
 *
 * **Namespace-prefixed literals, deliberately.** They are values rather than
 * `t()` arguments, so the compiler checks them as `TranslationKey` (ADR-0046
 * §7) and the drift check reads them as references to `common:` keys without
 * needing to know what the kit does with them (ADR-0046 §9).
 */
export const UI_STRING_KEYS: UiStringKeys = {
  close: "common:ui.close",
  previous: "common:ui.previous",
  next: "common:ui.next",
  morePages: "common:ui.morePages",
  more: "common:ui.more",
  toggleSidebar: "common:ui.toggleSidebar",
  sidebarTitle: "common:ui.sidebarTitle",
  sidebarDescription: "common:ui.sidebarDescription",
  previousPage: "common:ui.previousPage",
  nextPage: "common:ui.nextPage",
  pagination: "common:ui.pagination",
  breadcrumb: "common:ui.breadcrumb",
  notifications: "common:ui.notifications",
  dismiss: "common:ui.dismiss",
  navigating: "common:ui.navigating",
};
