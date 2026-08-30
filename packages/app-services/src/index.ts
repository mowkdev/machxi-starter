/**
 * The tail of the extraction: the services an app runs on that belong to no
 * one slice (`D9.6`, [ADR-0051](../../../docs/adr/0051-platform-extraction.md)).
 *
 * Six packages before this one each had a single identity. This one is the
 * remainder ADR-0051 named and left to the extracting step to place, and the
 * placements are recorded here because the package's name cannot imply them:
 *
 * - **The theme** ([ADR-0045](../../../docs/adr/0045-user-settings.md) §Theme):
 *   the three pure functions that decide when `dark` is on `<html>`, and the
 *   provider that binds them to an account. Every colour they select is still
 *   the design system's; this decides only *when*.
 * - **`can()` and the capability narrowing**
 *   ([ADR-0042](../../../docs/adr/0042-client-side-authorization.md)): the
 *   predicate and the two hooks. **The policy table is not here** — it is a
 *   transcription of one API's `authorize(` calls and names one app's
 *   resources, so it stays in that app and arrives as an argument.
 * - **`route-meta`**: what a route declares about itself — its title, its
 *   height budget, its record label and its crumb trail
 *   ([ADR-0048](../../../docs/adr/0048-app-shell-and-record-surfaces.md) §2,
 *   [ADR-0037](../../../docs/adr/0037-grid-viewport-layout.md)). Router-coupled,
 *   so `@tanstack/react-router` is a **peer** for ADR-0051's reason.
 *
 * **What was in the tail and went elsewhere**, because a home is decided by
 * what a file names rather than by where it sat:
 *
 * - `bulk-outcome.ts` → `@repo/api-client`. It is a bounded fan-out over
 *   per-row API calls that reads `isApiClientError` and `ErrorMessage`, both of
 *   which are that package's; nothing in it knows a grid exists.
 * - `bulk-summary.ts` → `@repo/grid`. Every key it writes is `grid:bulk.*`,
 *   and `D9.5` settled that code travels with the copy it names.
 * - `messages.ts` and `query-meta.ts` stayed in `apps/admin`. The first reads
 *   that app's `errors` catalogue and the second declares that app's `meta`
 *   contract over its own `TranslationKey`; both are dictionary, not machinery
 *   ([ADR-0046](../../../docs/adr/0046-interface-localization.md) §13).
 */

export { can, type CanFn, type ResourcePolicy } from "./can";

export { allowedCapabilities } from "./capabilities";

export { useAllowedCapabilities, useCan } from "./auth-context";

export {
  useRouteCrumbs,
  useRouteDescription,
  useRouteFullHeight,
  useRouteRecordLabel,
  useRouteTitle,
  type RouteCrumb,
} from "./route-meta";

export {
  applyTheme,
  preferredTheme,
  prefersDark,
  readStoredTheme,
  resolveTheme,
  type Theme,
} from "./theme";

export {
  ThemeProvider,
  useTheme,
  type ThemeProviderProps,
  type ThemeView,
} from "./theme-context";
