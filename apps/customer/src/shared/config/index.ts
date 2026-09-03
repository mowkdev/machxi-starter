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
 * The build's version, substituted at compile time (ADR-0054 §5).
 *
 * **Not part of `config` above, and not in the schema, because it is not
 * environment.** `import.meta.env` is configuration a deployment sets; this is
 * a literal Vite splices into the source from `apps/customer/package.json`,
 * installed as a `define` by both `vite.config.ts` and `vitest.config.ts` (see
 * `app-version.ts` for why it is a tracked file rather than a variable or a
 * git SHA). Putting it in the zod object would claim a deployment could change
 * it, and would make an absent `.env` fail a build that has everything it
 * needs.
 *
 * The `declare` is the constant's only type: `define` substitutes text, so
 * nothing exists at runtime for a module to import. It is declared here — the
 * app's one configuration door — so that no component reaches for a bare
 * global. Its consumer is the sidebar footer, which arrives at `D12.5`.
 */
declare const __APP_VERSION__: string;

export const APP_VERSION: string = __APP_VERSION__;
