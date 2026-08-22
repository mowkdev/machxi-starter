import { z } from "zod";

/**
 * The only reader of `import.meta.env` in this app (ADR-0033 §Configuration).
 *
 * ADR-0004's discipline mapped to Vite: parse once, at module load, with a zod
 * schema, and hand everything else a typed frozen object. A missing or
 * malformed `VITE_API_URL` fails here, loudly, at the first import — not at the
 * first request, quietly, as a `baseURL` of `"undefined/api/v1/admin"`.
 *
 * **Everything in this schema is compile-time public.** Vite inlines `VITE_*`
 * into the served bundle, so anyone who loads the page can read it. Nothing
 * secret may ever be added here — that is not a weakness of the design, it is
 * what "configuration of a browser app" means, and saying it in the file is
 * what keeps a future API key out of it.
 *
 * ADR-0026 consequence: because the value is inlined, it is an input to the
 * cached `build`, which is why `apps/admin/turbo.json` declares it. The test
 * tasks stay out of it by construction — the harness pins a fixed value inside
 * the repository (ADR-0036), so no test reads the environment at all.
 */
const envSchema = z.object({
  /** Where the API answers, with no trailing path: the client appends the segment. */
  VITE_API_URL: z.url(),
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
});

export type AppConfig = Readonly<z.infer<typeof envSchema>>;

export const config: AppConfig = Object.freeze(
  envSchema.parse(import.meta.env),
);
