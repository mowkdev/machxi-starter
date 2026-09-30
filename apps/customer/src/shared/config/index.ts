import { z } from "zod";

/**
 * The only reader of `import.meta.env` in this app (ADR-0033 §Configuration, as
 * carried by ADR-0051; the app is ADR-0055).
 *
 * ADR-0004's discipline mapped to Vite: parse once, at module load, with a zod
 * schema, and hand everything else a typed frozen object. A missing or
 * malformed `VITE_API_URL` fails here, loudly, at the first import — not at the
 * first request, quietly, as a `baseURL` of `"undefined/api/v1/user"`.
 *
 * **Everything in this schema is compile-time public.** Vite inlines `VITE_*`
 * into the served bundle, so anyone who loads the page can read it. Nothing
 * secret may ever be added here — that is not a weakness of the design, it is
 * what "configuration of a browser app" means, and saying it in the file is
 * what keeps a future API key out of it.
 *
 * ADR-0026 consequence: because the value is inlined, it is an input to the
 * cached `build`, which is why `apps/customer/turbo.json` declares it. The test
 * tasks stay out of it by construction — the harness pins a fixed value inside
 * the repository (ADR-0036), so no test reads the environment at all.
 */
const envSchema = z.object({
  /** Where the API answers, with no trailing path: the client appends the segment. */
  VITE_API_URL: z.url(),
  /**
   * The brand this build's device-storage keys are prefixed with
   * (ADR-0064 §1).
   *
   * Defaulted to `machxi`, like the API's own `APP_ID` and for the same
   * reason: a build that never sets it keeps every key this app has always
   * written. The two variables are two halves of one identity and a fork sets
   * both — a deployment whose API says `acme` and whose SPA says `machxi`
   * has cookies from one brand and preferences from another.
   *
   * Constrained to the API's grammar rather than left free: the same word
   * names cookies there, and a value this schema accepted but that one
   * refused would be a mismatch nothing reports.
   */
  VITE_APP_ID: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
    .max(32)
    .default("machxi"),
  /**
   * The dev-only pseudo-locale of ADR-0046 §10, off unless a build asks for it.
   *
   * `z.stringbool()` because an environment variable is a string and
   * `Boolean("false")` is `true` — the classic way a flag ends up permanently
   * on. Defaulted rather than required, because the variable is absent in every
   * ordinary build and a required flag would make `.env` a prerequisite for
   * running the app.
   *
   * It is **not** a locale (`LOCALES` is the production set and lives in a
   * database column); it is a lens over `en`, which is why it arrives as
   * configuration rather than as a member of an enum.
   */
  VITE_I18N_PSEUDO: z.stringbool().default(false),
  /**
   * The error-reporting seam (ADR-0066 §3), off unless a build sets it.
   *
   * `shared/error-reporting` branches on the absence: no DSN means no reporter
   * and no adapter chunk downloaded. A DSN is an ingest address rather than a
   * credential, which is why it may live in a file this app inlines into the
   * bundle — the note at the top of this schema still holds for everything
   * else.
   *
   * The scheme is constrained for the reason `VITE_CUSTOMER_APP_URL` is: a
   * bare `z.url()` accepts `javascript:` and `data:`, and this value is handed
   * to a client that will open whatever it parses.
   */
  VITE_ERROR_REPORTING_DSN: z
    .url({ protocol: z.regexes.httpProtocol })
    .optional(),
  /**
   * Whether this build offers self-service registration (ADR-0067 §6).
   *
   * `z.stringbool()` and `default(true)` mirror the API's own
   * `FEATURE_USER_REGISTRATION` exactly, because the two are one decision
   * spelled in two places — and **the API's is the control**. This one decides
   * whether `/register` and the link to it exist in the bundle; the endpoint
   * exists or does not regardless, and a build with this flag on against an
   * API with its own off reaches a `404 ROUTE_NOT_FOUND` and renders the
   * catalogue's sentence for it. A client flag that could *enable* the feature
   * would be a control in the one place a customer can edit.
   *
   * Defaulted on rather than off, like the API's: a deployment that sets
   * neither gets the behaviour ADR-0018 decided, and turning registration off
   * is the deliberate act.
   */
  VITE_FEATURE_USER_REGISTRATION: z.stringbool().default(true),
  /**
   * Whether this build offers "Continue with Google" (ADR-0072 §4).
   *
   * `VITE_FEATURE_USER_REGISTRATION`'s twin, and **the API's mount is the
   * control** in exactly the same way: the three routes exist only where the
   * API is given a Google client, so a build with this on against an API
   * without one reaches `404 ROUTE_NOT_FOUND` and renders the catalogue's
   * sentence for it. This decides whether the button is in the bundle and
   * nothing more.
   *
   * **Defaulted off, where registration's twin is defaulted on**, and the
   * asymmetry is the API's: registration is on unless a deployment turns it
   * off, while Google is off until a deployment registers a client with
   * Google's console and hands the API both halves of it. A button that is on
   * by default would be a button that answers not-found by default.
   */
  VITE_FEATURE_GOOGLE_SIGN_IN: z.stringbool().default(false),
});

export type AppConfig = Readonly<z.infer<typeof envSchema>>;

export const config: AppConfig = Object.freeze(
  envSchema.parse(import.meta.env),
);

/**
 * The segment this app speaks to (ADR-0015, ADR-0051).
 *
 * One word, stated once: `createApiClient` takes it, and
 * {@link DEVICE_KEY_PREFIX} is built from it, so the app that declares which
 * half of the API it talks to also declares which device keys it owns.
 */
export const API_SEGMENT = "user" as const;

/**
 * Everything this app persists on a device is prefixed with this
 * (ADR-0064 §1).
 *
 * `${appId}.${segment}` — `machxi.user` by default — and the
 * three packages that hold device state (`@repo/app-services`, `@repo/i18n`,
 * `@repo/grid`) take it as a parameter rather than a constant. The `shared/`
 * doors bind it, so no slice in this app ever names a key and a fork's brand
 * lives in its `.env` and its doors rather than in a package it does not own.
 *
 * It also closes D12's finding 1: the two SPAs used to share
 * `machxi.admin.*`, so an operator and a customer on one origin shared a
 * theme, a locale and every grid arrangement.
 */
export const DEVICE_KEY_PREFIX = `${config.VITE_APP_ID}.${API_SEGMENT}`;

/**
 * Which optional surfaces this build offers (`D15.6`, ADR-0067 §6).
 *
 * A named object rather than a bare read of `config`, because its consumer is
 * the **router context**: a route's `beforeLoad` is not a React component and
 * cannot reach a provider, so the one seam a flag can travel through to a
 * guard is the context `createAppRouter` builds. Passing the whole `config`
 * there would put every variable in reach of every route; this names exactly
 * what a route may ask about, which since `D19.3` is two things.
 *
 * The shape is what makes it testable at all, and it is `PseudoNoticeProvider`'s
 * lesson one layer down: `vitest.config.ts` pins the environment for the whole
 * suite, so a guard reading `import.meta.env` directly would have exactly one
 * value in every test in this repository. `createAppRouter` takes an override;
 * this is its default.
 */
export interface AppFeatures {
  /** `/register` and the sign-in screen's link to it (ADR-0067 §6). */
  readonly userRegistration: boolean;
  /**
   * "Continue with Google" under the sign-in card and, with
   * {@link userRegistration}, under the sign-up card (ADR-0072 §4). No guard
   * reads it — `/auth/google` exists in every build, because a callback can
   * land there whatever this build offers — so its readers are the two pages,
   * through the same router context the registration flag travels on.
   */
  readonly googleSignIn: boolean;
}

export const FEATURES: AppFeatures = Object.freeze({
  userRegistration: config.VITE_FEATURE_USER_REGISTRATION,
  googleSignIn: config.VITE_FEATURE_GOOGLE_SIGN_IN,
});

/**
 * The build the sidebar footer names, substituted at compile time (ADR-0081
 * §1–§3, the delta on ADR-0054 §5; `D32.2`, and `D32.5` for the label alone).
 *
 * `APP_VERSION` is the release label the image was built with, or `dev`. It
 * comes from the build's own environment under that name, through the
 * `define` `vite.config.ts` and `vitest.config.ts` install from
 * `app-version.ts`; no `package.json` is read. There is no commit: the footer
 * shows the label alone, and the commit is the API's `/health` fact.
 *
 * **Not part of `config` above, and not in the schema.** `import.meta.env`
 * is the `VITE_*` configuration a deployment sets per environment; the label
 * is a fact about the build, one value for the whole product, and a
 * `VITE_`-named twin would be a second name for it (ADR-0081 §2). Putting it
 * in the zod object would also make an absent `.env` fail a build that has
 * everything it needs.
 *
 * The `declare` is the constant's only type: `define` substitutes text, so
 * nothing exists at runtime for a module to import. It is declared here — the
 * app's one configuration door — so that no component reaches for a bare
 * global.
 */
declare const __APP_VERSION__: string;

export const APP_VERSION: string = __APP_VERSION__;
