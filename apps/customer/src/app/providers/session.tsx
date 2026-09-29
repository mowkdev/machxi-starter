import { createAppSession } from "@/shared/api/session";
import { config } from "@/shared/config";
import { EN_RESOURCES } from "@/shared/i18n";

/**
 * The session, bound to this app (ADR-0049: `app` is wiring).
 *
 * The machinery — the store, the client, the boot gate and the screen shown
 * when the API cannot be reached — is `@repo/app-kit`'s since `D22.1`
 * (ADR-0077 §1). What is stated here is what made this file differ from the
 * admin's, and it is three values.
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
  /*
   * **The app's population, and the only place it is stated** (ADR-0055 §2).
   *
   * `@repo/api-client` is segment-agnostic since `D9.1`, and this one word is
   * the whole of what makes this app the customer app on the wire: every
   * request goes to `/api/v1/user`, and `shared/api/context` narrows the
   * principal to match. ADR-0015's segments are enforced server-side either
   * way — this is the client agreeing rather than the client deciding.
   */
  segment: "user",
  baseUrl: config.VITE_API_URL,
  /*
   * **The sentence names no environment variable, and that is the one line
   * that differs from the admin's.** The admin's notice interpolates
   * `VITE_API_URL`, because the person reading it is a developer or an
   * operator running the panel. The person reading this one is a customer,
   * for whom a build-time variable name is noise at best and a hint about our
   * infrastructure at worst — so the sentence says what happened and what
   * they can do, and the diagnosis stays in the console where the client
   * already logs it.
   */
  unreachable: { fallback: EN_RESOURCES.common.boot.unreachable },
});

export type { SessionProviderProps } from "@/shared/api/session";
