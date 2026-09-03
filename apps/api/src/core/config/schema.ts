import { defaultArgon2Params, minArgon2Params } from "@repo/crypto";
import { z } from "zod";

// Through `core/db`, the API's one view of `@repo/db` (ADR-0009). The two
// defaults are stated by `createDb` and mirrored into this schema rather than
// retyped, for the reason the argon2 parameters are taken from `@repo/crypto`:
// a floor or a default that exists in two places is a floor that will one day
// exist in one.
import {
  DEFAULT_IDLE_TRANSACTION_TIMEOUT_MS,
  DEFAULT_STATEMENT_TIMEOUT_MS,
} from "../db/index.js";
import { parseDurationSeconds } from "./duration.js";
import { isProductionTrustProxy } from "./trust-proxy.js";

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
 * The `JWT_ACCESS_SECRET` shipped in `docker/prod/.env.example`.
 *
 * The third, and the one most likely to be copied verbatim: that file is the
 * checklist for a **production** compose deployment, and `docs/deploy.md`
 * documents `cp docker/prod/.env.example docker/prod/.env` as the way to try
 * the images locally. It is 41 characters, so length alone accepts it.
 */
export const PROD_COMPOSE_JWT_ACCESS_SECRET =
  "replace-me-with-48-random-bytes-base64url";

/**
 * Every signing key that exists in the repository, and is therefore public.
 *
 * A list rather than one comparison, because the placeholder is not the only
 * one: `.env.test` carries a second working key, `docker/prod/.env.example` a
 * third (`D14.3`), and each of those is the file someone copies when they want
 * something that already runs. All are 32+ characters, so length cannot tell
 * them apart from a real key — only enumeration can. A unit test reads every
 * one of those files and asserts its value appears here, so a fourth dummy key
 * cannot be added without being listed.
 */
export const KNOWN_PUBLIC_SECRETS: readonly string[] = [
  PLACEHOLDER_JWT_ACCESS_SECRET,
  TEST_JWT_ACCESS_SECRET,
  PROD_COMPOSE_JWT_ACCESS_SECRET,
];

/** The `SEED_SUPER_ADMIN_PASSWORD` shipped in `.env.example`. */
export const PLACEHOLDER_SEED_SUPER_ADMIN_PASSWORD = "ChangeMe123!local";

/** The `SEED_SUPER_ADMIN_PASSWORD` shipped in `apps/api/.env.test`. */
export const TEST_SEED_SUPER_ADMIN_PASSWORD = "TestSuperAdmin!123";

/**
 * Committed passwords for the seeded super admin (ADR-0008).
 *
 * The same problem as {@link KNOWN_PUBLIC_SECRETS} and a worse consequence: the
 * account these create holds `super_admin`, which bypasses every staff role
 * check (ADR-0019). `pnpm db:setup` is the documented deploy step, so a
 * production environment assembled by copying one of the committed env files
 * would seed an account whose password is in the repository. Length rules
 * cannot tell a public dummy from a real credential — only enumeration can.
 *
 * The seed runner never passes through this schema, so `@repo/db`'s
 * `tooling/env.ts` enforces the same list; a test in each package reads the
 * committed files and asserts both lists cover them.
 */
export const KNOWN_PUBLIC_SEED_PASSWORDS: readonly string[] = [
  PLACEHOLDER_SEED_SUPER_ADMIN_PASSWORD,
  TEST_SEED_SUPER_ADMIN_PASSWORD,
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

/**
 * An optional variable that an env file may spell as an empty value.
 *
 * `REDIS_URL=` and `METRICS_TOKEN=` are how a committed `.env.example` writes
 * "set this if you have one", and compose's `KEY=${KEY}` turns an unset
 * variable into an empty string on its way into a container. Both would reach
 * a bare `.optional()` as `""` — a *stated* value — and fail the inner schema
 * with a message about a malformed URL rather than being read as absent.
 *
 * The blank is therefore folded into absence before the inner check runs,
 * which is the same reading `csvSchema` above gives an empty allow-list and
 * `TRUST_PROXY` gives `""` (ADR-0059 §7).
 */
const optionalEnv = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    schema.optional(),
  );

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
    //
    // The default is for a developer's machine. **Production must state the
    // hop** (ADR-0059 §7, the delta on ADR-0004 and ADR-0020), and the
    // refinement below checks the **resolved** value rather than the string:
    // `"false"`, `"0"` and `""` are one instruction to Express, and `""` is
    // what an unset variable becomes on its way through a compose file's
    // `TRUST_PROXY=${TRUST_PROXY}` — so a raw-string comparison would refuse
    // the spelling nobody writes by accident and pass the two that happen by
    // themselves. Neither failure is visible in a response, which is why they
    // are startup failures.
    TRUST_PROXY: z.string().default("false"),

    // The **application** role (ADR-0061 §1). `DATABASE_URL_OWNER` is
    // deliberately absent from this schema, exactly as `DATABASE_URL_TEST` is:
    // DDL belongs to `packages/db`'s tooling, and the API must not be able to
    // reach a connection that has any by reading its own configuration.
    DATABASE_URL: z.url(),
    DB_POOL_MAX: z.coerce.number().int().positive().default(10),
    DB_CONNECT_RETRIES: z.coerce.number().int().positive().default(10),
    // Session bounds carried by every connection in the pool (ADR-0061 §3).
    // Milliseconds, and `0` disables — hence `min(0)` rather than `positive()`:
    // turning one off is a deployment's decision to make, and `0` is what
    // Postgres itself reads as "no limit".
    DB_STATEMENT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(0)
      .default(DEFAULT_STATEMENT_TIMEOUT_MS),
    DB_IDLE_TX_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(0)
      .default(DEFAULT_IDLE_TRANSACTION_TIMEOUT_MS),
    DB_APPLICATION_NAME: z.string().min(1).default("machxi-api"),
    // `false` behind a transaction-mode pooler, where a prepared statement does
    // not survive to the next query on the same logical connection. The
    // `noPreparedStatements` option this feeds has existed since D1 with no
    // variable behind it, which meant that pooler could not actually be used.
    //
    // `z.stringbool()` for the reason `FEATURE_USER_REGISTRATION` gives below:
    // `z.coerce.boolean()` is `Boolean(value)` over a string, so `=false`
    // would parse to `true` and this could never be turned off.
    DB_PREPARED_STATEMENTS: z.stringbool().default(true),

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
    /**
     * The impersonation mint's own budget, keyed on the **staff principal's
     * id** rather than on an IP (ADR-0057 §1).
     *
     * It needs a limiter of its own because ADR-0020's login limiter keys on
     * `IP + email` read from the body, and a mint carries neither: it is an
     * authenticated, high-value operation, so the budget that means anything
     * is per actor. Ten per window is a support desk's day, and an account
     * spending it is worth a look.
     */
    RATE_LIMIT_IMPERSONATION_MAX: z.coerce
      .number()
      .int()
      .positive()
      .default(10),

    /**
     * How long an impersonated session may live, from the exchange (ADR-0057
     * §4).
     *
     * A **fixed** end, unlike `REFRESH_TOKEN_TTL`: rotation does not extend it
     * while the session carries an actor, and the access token's `exp` is
     * capped by it, so no credential outlives the window. An impersonation
     * that needs longer is re-minted, on the trail, never extended.
     *
     * Ceilinged at twelve hours, where no other TTL here is. `durationSchema`
     * alone accepts up to `365d`, and this is the only number keeping "a fixed
     * end" from being a phrase: a deployment that wrote `30d` would leave
     * rotation-without-extension technically true and practically retired,
     * with no startup failure to notice it. Generous on purpose — a support
     * sitting is minutes, and anything past a working day should be re-minted.
     */
    IMPERSONATION_SESSION_TTL: durationSchema
      .pipe(
        z
          .number()
          .int()
          .max(12 * 3600),
      )
      .default(30 * 60),
    /**
     * How long the one-time handoff token stays redeemable (ADR-0057 §2).
     *
     * Seconds, not minutes, and deliberately far shorter than any other TTL
     * here: this is the one credential in the system that travels through a
     * URL, so the window between the mint and the exchange is the window an
     * onlooker has. It is also strictly single-use, with no rotation grace —
     * the two properties together are why the refresh token could not play
     * this role (ADR-0018 §Refresh tolerates a replay for
     * `REFRESH_ROTATION_GRACE_SEC`).
     *
     * Ceilinged at five minutes, and this is the tighter of the two ceilings
     * because the whole safety argument for a URL-borne credential is "sixty
     * seconds is all an onlooker gets". `60m` typed where `60s` was meant, or
     * `60` read as minutes, would turn it into a long-lived token resident in
     * browser history and in whatever copied the link — a misconfiguration
     * that must fail at startup rather than at the first incident.
     */
    IMPERSONATION_HANDOFF_TTL: durationSchema
      .pipe(z.number().int().max(300))
      .default(60),
    CORS_ORIGINS: csvSchema,

    // `z.stringbool()`, never `z.coerce.boolean()`: the latter is
    // `Boolean(value)` over a string, so `=false` parses to `true` and the
    // flag can never be turned off (ADR-0004, amended 2026-08-18).
    FEATURE_USER_REGISTRATION: z.stringbool().default(true),

    // ─── Mail (ADR-0066 §1) ───────────────────────────────────────────────
    /**
     * Which transport `createMailSender` builds.
     *
     * **Optional rather than defaulted, and the absence is load-bearing**: the
     * refinement below refuses an unstated transport in production, so a
     * deployment states `log` or `smtp` instead of inheriting a default nobody
     * chose. `toAppConfig` reads an absent value as `log`, which is what makes
     * a fresh clone and the test run need no mail server at all — a port that
     * must be up to run the API is a worse default than a log line.
     */
    MAIL_TRANSPORT: optionalEnv(z.enum(["log", "smtp"])),
    /**
     * The envelope sender. A deployment's fact, never a caller's — no code
     * path can choose the address a message is sent as.
     */
    MAIL_FROM: z.email().default("no-reply@machxi.local"),
    /**
     * The `SMTP_*` defaults are **Mailpit's** (`docker/local/compose.yaml`):
     * `localhost:1025`, no TLS, no credentials. So `MAIL_TRANSPORT=smtp` on a
     * developer's machine needs nothing else set, and the message appears in a
     * browser at `http://localhost:8025`.
     */
    SMTP_HOST: z.string().min(1).default("localhost"),
    SMTP_PORT: z.coerce.number().int().positive().max(65535).default(1025),
    /** Implicit TLS (port 465); `false` still upgrades through STARTTLS. */
    SMTP_SECURE: z.stringbool().default(false),
    // Both, or neither: nodemailer treats the presence of credentials as
    // "authenticate", so half a pair would send an empty AUTH to a relay that
    // wanted none.
    SMTP_USER: optionalEnv(z.string().min(1)),
    SMTP_PASSWORD: optionalEnv(z.string().min(1)),

    // ─── Observability (ADR-0066 §2, §3) ──────────────────────────────────
    /**
     * The bearer token `GET /metrics` requires (ADR-0066 §2).
     *
     * Unset means unauthenticated, which the refinement below permits outside
     * production only: the body is numbers, but the numbers **name every route
     * the API has**. 32 characters, because this is a bearer credential and
     * the endpoint is unauthenticated without it.
     */
    METRICS_TOKEN: optionalEnv(z.string().min(32)),
    /**
     * Turns the error-reporting seam on (ADR-0066 §3). Absent means no
     * reporter is built and the adapter module is never evaluated.
     *
     * The scheme is constrained for the reason `VITE_CUSTOMER_APP_URL` is: a
     * bare `z.url()` accepts `javascript:`, `data:` and `file://`, and this
     * value decides where a stack trace is sent.
     */
    ERROR_REPORTING_DSN: optionalEnv(z.url({ protocol: /^https?$/ })),

    /**
     * The shared rate-limit store (ADR-0066 §4). Absent means the in-memory
     * default, which counts per process — correct for one instance and wrong
     * for two.
     *
     * `redis:` or `rediss:` and nothing else, for the same reason as above:
     * this string is handed to a client that will happily try to open
     * whatever it parses.
     */
    REDIS_URL: optionalEnv(z.url({ protocol: /^rediss?$/ })),

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
    (env) =>
      env.NODE_ENV !== "production" ||
      env.SEED_SUPER_ADMIN_PASSWORD === undefined ||
      !KNOWN_PUBLIC_SEED_PASSWORDS.includes(env.SEED_SUPER_ADMIN_PASSWORD),
    {
      path: ["SEED_SUPER_ADMIN_PASSWORD"],
      message:
        "is a value committed in this repository and must not seed a production super admin",
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
    (env) =>
      env.NODE_ENV !== "production" || isProductionTrustProxy(env.TRUST_PROXY),
    {
      path: ["TRUST_PROXY"],
      message:
        'must state the proxy hop in production: a count, a CIDR list, or "loopback". Both constants are refused, and so is anything that resolves to one — "true" makes Express take the left-most X-Forwarded-For entry verbatim, so req.ip becomes attacker-controlled and the login rate limit bypassable (ADR-0020), while "false", "0" and an empty value make every request behind a proxy report the proxy\'s address instead, collapsing the login limiter, the refresh limiter and the audit trail onto one key (ADR-0059 §7). A production deployment with nothing in front of it is the case this refuses to guess at',
    },
  )
  .refine(
    (env) => env.NODE_ENV !== "production" || env.MAIL_TRANSPORT !== undefined,
    {
      path: ["MAIL_TRANSPORT"],
      message:
        'must be stated in production: "log" or "smtp" (ADR-0066 §1). An unset value is read as "log" everywhere else, which is what lets a fresh clone and the test run work with no mail server — but a production deployment that inherits it swallows every message it ever sends, silently and with a log line nobody is reading',
    },
  )
  .refine(
    (env) =>
      (env.SMTP_USER === undefined) === (env.SMTP_PASSWORD === undefined),
    {
      path: ["SMTP_USER"],
      message:
        'must be set together with SMTP_PASSWORD, or neither (ADR-0066 §1). nodemailer reads the *presence* of credentials as "authenticate", so half a pair is silently dropped and the API connects to the relay unauthenticated — a mail path whose security properties differ from what the operator configured, with nothing in a response or a log to say so',
    },
  )
  .refine(
    (env) => env.NODE_ENV !== "production" || env.METRICS_TOKEN !== undefined,
    {
      path: ["METRICS_TOKEN"],
      message:
        "must be set in production (ADR-0066 §2): GET /metrics is unauthenticated without it, and its body names every route the API has. At least 32 characters — it is a bearer credential",
    },
  );

export type Env = z.infer<typeof envSchema>;
