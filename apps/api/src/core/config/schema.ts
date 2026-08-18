import { defaultArgon2Params, minArgon2Params } from "@repo/crypto";
import { z } from "zod";

import { parseDurationSeconds } from "./duration.js";

/**
 * The environment contract of the API process (ADR-0004).
 *
 * Every variable the API reads is declared here, with a safe default where one
 * exists. Adding a variable is a three-place change: this schema,
 * `.env.example`, and the deployment secret store.
 *
 * Tooling-only variables are deliberately absent: `DATABASE_URL_TEST` (the
 * vitest `globalSetup`, ADR-0021) and `POSTGRES_*` (docker compose, ADR-0007)
 * are not part of this contract, so the API can never connect to the test
 * database by reading its own configuration.
 */

/** `LOG_LEVEL` accepts the six real levels; `silent` is a factory-only level (ADR-0005). */
export const LOG_LEVELS = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
] as const;

export const NODE_ENVS = ["development", "test", "production"] as const;

/**
 * The `JWT_ACCESS_SECRET` shipped in `.env.example`.
 *
 * It is 41 characters, so `min(32)` alone would let a publicly known signing
 * key reach production: anyone with the repository could mint access tokens
 * for that deployment. Keeping a *working* placeholder is deliberate — a fresh
 * clone must run without a key-generation step (ADR-0021 acceptance checklist).
 */
export const PLACEHOLDER_JWT_ACCESS_SECRET =
  "dev-only-insecure-access-secret-change-me";

/** The `JWT_ACCESS_SECRET` shipped in `apps/api/.env.test`. */
export const TEST_JWT_ACCESS_SECRET =
  "test-only-signing-key-do-not-use-anywhere-else";

/**
 * Every signing key that exists in the repository, and is therefore public.
 *
 * A list rather than one comparison, because the placeholder is not the only
 * one: `.env.test` carries a second working key, and `.env.test` is the file
 * someone copies when they want something that already runs. Both are 32+
 * characters, so length cannot tell them apart from a real key — only
 * enumeration can. A unit test reads both files and asserts their values appear
 * here, so a third dummy key cannot be added without being listed.
 */
export const KNOWN_PUBLIC_SECRETS: readonly string[] = [
  PLACEHOLDER_JWT_ACCESS_SECRET,
  TEST_JWT_ACCESS_SECRET,
];

/** Shortest accepted signing key, in characters. */
const MIN_JWT_SECRET_LENGTH = 32;

/**
 * A browser origin: scheme, host and optional port, and nothing else.
 *
 * Not `z.url()` on its own — `new URL("localhost:3001")` succeeds, reading
 * `localhost:` as the scheme, so the most likely typo would pass. `cors`
 * compares the `Origin` header against these strings exactly, so a trailing
 * slash or a path makes an entry that can never match; failing at startup is
 * better than a CORS rule that silently does nothing.
 */
const originSchema = () =>
  z
    .url({ protocol: /^https?$/ })
    .refine((value) => URL.parse(value)?.origin === value, {
      message: "must be a bare origin, e.g. https://admin.example.com",
    });

/**
 * A comma-separated allow-list, e.g. `CORS_ORIGINS=http://a,http://b`.
 *
 * An empty or absent value yields `[]` — "no browser origin allowed" — rather
 * than `['']`, which `cors` would treat as an origin (ADR-0020). Each entry
 * must parse as a URL: `credentials: true` makes every one of them a
 * credential-bearing cross-origin grant, and a typo would otherwise become a
 * silently dead entry rather than a startup failure.
 */
const csvSchema = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ""),
  )
  .pipe(z.array(z.union([z.literal("*"), originSchema()])));

/**
 * A duration written the way an operator writes it (`15m`, `30d`), stored as
 * seconds.
 *
 * The message names the accepted form and never echoes the rejected value
 * (ADR-0004): a TTL is not a secret, but "config errors report keys and
 * constraints, not values" has no useful exceptions.
 */
const durationSchema = z
  .string()
  .min(1)
  .transform((value, ctx) => {
    const seconds = parseDurationSeconds(value);

    if (seconds === null) {
      ctx.addIssue({
        code: "custom",
        message:
          "must be a duration like 15m, 12h or 30d (positive integer followed by s, m, h or d; at most 365d)",
      });

      return z.NEVER;
    }

    return seconds;
  });

export const envSchema = z
  .object({
    // No default, on purpose. Every production hardening below branches on
    // this value, as does `error.debug` in the error middleware (ADR-0013), so
    // a default of "development" would mean a deployment that simply never set
    // the variable — a Dockerfile, a systemd unit, a PaaS that only injects
    // secrets — silently accepts the committed signing key, accepts `*` as a
    // CORS origin and returns stack traces to clients. Permissive behaviour has
    // to be asked for explicitly; an absent NODE_ENV is a startup failure.
    NODE_ENV: z.enum(NODE_ENVS),
    PORT: z.coerce.number().int().positive().max(65535).default(4000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
    APP_VERSION: z.string().default("0.0.0"),
    GIT_SHA: z.string().optional(),
    // Express `trust proxy`: 'false' | 'true' | a hop count | a CIDR list.
    // Interpreted by `toTrustProxy`; kept as a string here because the three
    // forms are what Express itself accepts.
    TRUST_PROXY: z.string().default("false"),

    DATABASE_URL: z.url(),
    DB_POOL_MAX: z.coerce.number().int().positive().default(10),
    DB_CONNECT_RETRIES: z.coerce.number().int().positive().default(10),

    JWT_ISSUER: z.string().min(1).default("machxi-api"),
    JWT_ACCESS_SECRET: z.string().min(MIN_JWT_SECRET_LENGTH),
    // Seconds, not the string: the JWT's `exp`, the `accessTokenExpiresAt`
    // field of the response and the session's `refresh_token_expires_at` all
    // have to be derived from one number, and an unparseable duration must
    // fail at startup rather than on the first login of a deployment.
    // The defaults are the *parsed* form, because `.default()` in zod 4
    // supplies the output of the pipe: 15m and 30d, in seconds.
    JWT_ACCESS_TTL: durationSchema.default(15 * 60),
    REFRESH_TOKEN_TTL: durationSchema.default(30 * 86400),
    REFRESH_ROTATION_GRACE_SEC: z.coerce.number().int().min(0).default(30),
    /**
     * How many argon2 hashes may run at once (ADR-0020 §Hashing cost vs.
     * liveness). Each occupies one libuv thread and 64 MiB for ~130 ms and the
     * default pool is 4, so an uncapped login endpoint starves DNS and
     * filesystem work process-wide at a request rate far below the global
     * limit. Raise it together with `UV_THREADPOOL_SIZE`, never alone.
     */
    AUTH_MAX_CONCURRENT_HASHES: z.coerce.number().int().positive().default(4),

    // Defaults and the floor both come from `@repo/crypto`, so the OWASP
    // parameters are stated once (ADR-0018). `createArgon2Hasher` rejects
    // anything below the floor as well — this only turns a misconfiguration
    // into a startup failure instead of a first-login failure.
    ARGON2_MEMORY_KIB: z.coerce
      .number()
      .int()
      .min(minArgon2Params.memoryKib)
      .default(defaultArgon2Params.memoryKib),
    ARGON2_TIME_COST: z.coerce
      .number()
      .int()
      .min(minArgon2Params.timeCost)
      .default(defaultArgon2Params.timeCost),
    ARGON2_PARALLELISM: z.coerce
      .number()
      .int()
      .min(minArgon2Params.parallelism)
      .default(defaultArgon2Params.parallelism),

    RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().positive().default(300),
    RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),
    // Counts **failed** refreshes only (ADR-0020): a client whose access token
    // expires every 15 minutes must not spend its budget on succeeding.
    RATE_LIMIT_REFRESH_MAX: z.coerce.number().int().positive().default(5),
    CORS_ORIGINS: csvSchema,

    // `z.stringbool()`, never `z.coerce.boolean()`: the latter is
    // `Boolean(value)` over a string, so `=false` parses to `true` and the
    // flag can never be turned off (ADR-0004, amended 2026-08-18).
    FEATURE_USER_REGISTRATION: z.stringbool().default(true),

    // Read by the seed runner, not by the API (ADR-0008). They are validated
    // here so a deployment whose seed credentials are unusable fails at
    // startup, and they are deliberately **not** carried into `AppConfig` —
    // nothing in the request path may reach a credential that only the
    // seeder needs.
    SEED_SUPER_ADMIN_EMAIL: z.email().optional(),
    SEED_SUPER_ADMIN_PASSWORD: z.string().min(12).optional(),
  })
  .refine(
    (env) =>
      env.NODE_ENV !== "production" ||
      !KNOWN_PUBLIC_SECRETS.includes(env.JWT_ACCESS_SECRET),
    {
      path: ["JWT_ACCESS_SECRET"],
      message:
        "is a value committed in this repository and must not be used in production",
    },
  )
  .refine(
    (env) => env.NODE_ENV !== "production" || !env.CORS_ORIGINS.includes("*"),
    {
      path: ["CORS_ORIGINS"],
      message:
        'must not contain "*" in production; list the exact origins (ADR-0020)',
    },
  )
  .refine(
    (env) => env.NODE_ENV !== "production" || env.TRUST_PROXY.trim() !== "true",
    {
      path: ["TRUST_PROXY"],
      message:
        'must not be "true" in production; Express then takes the left-most X-Forwarded-For entry verbatim, which makes req.ip attacker-controlled and the login rate limit bypassable (ADR-0020). Use a hop count, a CIDR list, or "loopback"',
    },
  );

export type Env = z.infer<typeof envSchema>;
