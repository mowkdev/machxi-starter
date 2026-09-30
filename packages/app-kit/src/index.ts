/**
 * The seventh platform package: the composition both SPAs share (ADR-0062 §1).
 *
 * [ADR-0051](../../../docs/adr/0051-platform-extraction.md) moved the
 * behavioural machinery into six packages and left every app its own
 * composition. D12 then measured what that cost: of roughly 128 files under
 * `apps/customer/src`, about 110 had a same-path twin in `apps/admin/src` and
 * about 52 were code-identical — and they had already drifted in both
 * directions. The customer's stylesheet had lost a package's utilities; the
 * customer's router had error defaults the admin still lacked; the customer's
 * lint config generated its doors from a table the admin hand-copied nine
 * times. **Nothing owned the composition, so nothing could keep it one.**
 *
 * What is here is what both apps compose identically:
 *
 * - **`providers/`** — the query client with ADR-0034's global notification
 *   caches and the `meta` augmentation that types them, the i18n provider with
 *   ADR-0046 §4's adoption latch, and the `UiStrings` filler of §12. Since
 *   `D22.1` (ADR-0077 §1) also the session provider with its unreachable
 *   notice, the principal-cache boundary and the root composition that orders
 *   them, each parameterised by what differed between the apps.
 * - **`layouts/`** — the auth screen of ADR-0054 §7, the account area's shell
 *   and summary of ADR-0053, and the settings options control.
 * - **`feedback/`** — the boot loader both gates render, §2's top-level
 *   error boundary, which neither app had, and the factory of the reporter
 *   that boundary is handed (ADR-0066 §3).
 * - **`router/`** — the localized error and not-found components, the crash
 *   surface the boundary falls back to, and (`D31.3`) the pending component
 *   with its threshold and minimum.
 * - **`i18n/`** — the app i18n factory of ADR-0046 §13.
 * - **`testing/`**, reached separately as `@repo/app-kit/testing` — the MSW
 *   server, the jsdom setup file, and (`D20.10`) the envelope builders and
 *   the list-query reader every handler in both apps goes through.
 *
 * **What is deliberately *not* here** (ADR-0062 §1, amended at `D14.8`, as
 * carried by ADR-0077 §1): the settings provider, the router itself and the
 * render helpers. Each is built out of an app's entities, its policy table or
 * its route tree, and §Consequences forbids this package to learn any of them.
 * The rule that decides the boundary is not "is it duplicated" but "can a door
 * bind the difference with a value" — and `D22.1` moved the session and the
 * principal cache across it on exactly that test: a segment, a sentence and a
 * key function are values.
 *
 * **The dependency direction is downward-only.** This is the first package
 * that may depend on other platform packages; none of them may depend on it.
 *
 * **The barrel below is the inventory, not everything the files export.** The
 * two notifying-cache factories and the reporter's type are reachable from
 * their own modules and are not re-exported here, for the reason the admin's
 * `shared/ui/index.ts` gives about doors: a surface nothing exercises is a
 * surface nobody maintains, and `type AppErrorBoundaryProps["report"]` already
 * names the reporter for anyone who needs to type one.
 *
 * Every app reaches this through its own `shared/` doors, exactly as it
 * reaches the six D9 packages — one more row in a `DOORS` table, not a new
 * kind of dependency (ADR-0051's door rule, applied once more).
 */

export {
  createQueryClient,
  type QueryClientOptions,
} from "./providers/query-client";

export { createI18nProvider, type I18nProviderProps } from "./providers/i18n";

export {
  createAppSession,
  type AppSession,
  type AppSessionOptions,
  type SessionProviderProps,
  type UnreachableNoticeCopy,
} from "./providers/session";

export {
  createPrincipalCache,
  type PrincipalCache,
  type PrincipalCacheBoundaryProps,
} from "./providers/principal-cache";

export {
  AppRoot,
  type AppGate,
  type AppRootProps,
  type ErrorMessageBinding,
} from "./providers/app-root";

export {
  AppUiStrings,
  type AppUiStringsProps,
  type UiStringKeys,
} from "./providers/ui-strings";

export { AuthLayout, type AuthLayoutProps } from "./layouts/auth-layout";

export {
  ACCOUNT_SECTION_LINK,
  AccountShell,
  AccountSummary,
  type AccountShellProps,
  type AccountSummaryProps,
} from "./layouts/account-shell";

export {
  SettingsOptions,
  type SettingsOption,
  type SettingsOptionsProps,
} from "./layouts/settings-options";

export { AppLoader, type AppLoaderProps } from "./feedback/app-loader";

export {
  AppErrorBoundary,
  type AppErrorBoundaryProps,
} from "./feedback/error-boundary";

export {
  createErrorReporter,
  type ErrorContext,
  type ErrorReportAdapter,
  type ErrorReporter,
} from "./feedback/error-reporting";

export { AppCrash, AppError, AppNotFound } from "./router/defaults";

export { AppPending, PENDING_MIN_MS, PENDING_MS } from "./router/pending";

export {
  createAppI18nFactory,
  type AppI18nDeps,
  type AppI18nOptions,
  type PackageCatalogue,
} from "./i18n/create-app-i18n";
