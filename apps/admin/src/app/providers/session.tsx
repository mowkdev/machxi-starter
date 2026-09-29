import { createAppSession } from "@/shared/api/session";
import { config } from "@/shared/config";
import { EN_RESOURCES } from "@/shared/i18n";

/**
 * The session, bound to this app (ADR-0049: `app` is wiring).
 *
 * The machinery — the store, the client, the boot gate and the screen shown
 * when the API cannot be reached — is `@repo/app-kit`'s since `D22.1`
 * (ADR-0077 §1). What is stated here is what made this file differ from the
 * customer app's, and it is three values.
 *
 * The exports are module-scope singletons because there is exactly one
 * session per document, and because the router — created at module scope in
 * `./router` — needs the same store its guards read. Tests never touch these:
 * they build their own store and client and pass them through the provider's
 * props.
 *
 * The React-facing hooks are **not** here. They live in `shared/api/context`,
 * because a feature may not import from `app` (ADR-0049) — a `useApiClient`
 * exported from this file would be unusable by the login form that needs it.
 */
export const {
  SessionProvider,
  apiClient,
  bootstrapSession,
  onSessionEnded,
  sessionStore,
} = createAppSession({
  // The app's own population, and the only place it is stated (`D9.1`,
  // ADR-0051): `@repo/api-client` is segment-agnostic, and this is the staff
  // panel, so every request it makes goes to `/api/v1/admin`.
  segment: "admin",
  baseUrl: config.VITE_API_URL,
  unreachable: {
    fallback: EN_RESOURCES.common.boot.unreachable,
    /*
     * The variable the notice names, spelled once. It is the *name* of a
     * configuration key rather than a value read from one, so it is not an
     * ADR-0004 read and does not belong in `shared/config`; and it is an
     * identifier rather than copy, which is why it is interpolated into the
     * sentence instead of being written inside it. The person reading this
     * notice is a developer or an operator running the panel.
     */
    values: { variable: "VITE_API_URL" },
  },
});

export type { SessionProviderProps } from "@/shared/api/session";
