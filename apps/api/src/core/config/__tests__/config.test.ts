import { defaultArgon2Params, minArgon2Params } from "@repo/crypto";
import { describe, expect, it } from "vitest";

import {
  KNOWN_PUBLIC_SECRETS,
  LOCAL_ADMIN_APP_URL,
  LOCAL_CUSTOMER_APP_URL,
  PLACEHOLDER_JWT_ACCESS_SECRET,
  envSchema,
  formatConfigIssues,
  loadConfig,
  toTrustProxy,
} from "../index.js";

/**
 * ADR-0004: configuration is validated once, at startup, and misconfiguration
 * is a startup failure rather than a surprise on the first request that needs
 * the value.
 */

const validEnv = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://machxi:machxi@localhost:5432/machxi",
  JWT_ACCESS_SECRET: "a".repeat(32),
} as const;

const parse = (overrides: Record<string, string> = {}) =>
  envSchema.parse({ ...validEnv, ...overrides });

describe("envSchema", () => {
  it("requires NODE_ENV to be stated, never assumed", () => {
    // Every production guard below branches on it, as does `error.debug` in
    // the error middleware — a default of "development" would mean a
    // deployment that never set the variable silently gets all of them.
    expect(() =>
      envSchema.parse({
        DATABASE_URL: validEnv.DATABASE_URL,
        JWT_ACCESS_SECRET: validEnv.JWT_ACCESS_SECRET,
      }),
    ).toThrow(/NODE_ENV/);
  });

  it("fills every optional variable with a default", () => {
    const env = parse();

    expect(env).toMatchObject({
      PORT: 4000,
      LOG_LEVEL: "info",
      APP_VERSION: "0.0.0",
      TRUST_PROXY: "false",
      DB_POOL_MAX: 10,
      DB_CONNECT_RETRIES: 10,
      JWT_ISSUER: "machxi-api",
      // Durations are parsed to seconds by the schema, so a typo fails at
      // startup rather than at the first login (ADR-0004).
      JWT_ACCESS_TTL: 15 * 60,
      REFRESH_TOKEN_TTL: 30 * 86400,
      REFRESH_ROTATION_GRACE_SEC: 30,
      AUTH_MAX_CONCURRENT_HASHES: 4,
      RATE_LIMIT_GLOBAL_MAX: 300,
      RATE_LIMIT_LOGIN_MAX: 10,
      RATE_LIMIT_REFRESH_MAX: 5,
      RATE_LIMIT_IMPERSONATION_MAX: 10,
      // Also seconds, and the two impersonation windows differ by three orders
      // of magnitude on purpose (ADR-0057 §2/§4): the session is a support
      // sitting, the handoff is a credential in a URL.
      IMPERSONATION_SESSION_TTL: 30 * 60,
      IMPERSONATION_HANDOFF_TTL: 60,
      FEATURE_USER_REGISTRATION: true,
      // The two SPA dev servers, so a fresh clone mails clickable links with
      // nothing configured (ADR-0071 §1). Production refuses both of these
      // exact values — see the production guards below.
      CUSTOMER_APP_URL: LOCAL_CUSTOMER_APP_URL,
      ADMIN_APP_URL: LOCAL_ADMIN_APP_URL,
      // Seconds, and the four differ because the four questions do: a day to
      // read your mail, an hour for a credential you just asked for, an hour
      // again for a takeover-enabling address change, a week for an operator
      // who may not start until Monday.
      VERIFICATION_TOKEN_TTL: 24 * 3600,
      PASSWORD_RESET_TOKEN_TTL: 3600,
      EMAIL_CHANGE_TOKEN_TTL: 3600,
      STAFF_ONBOARDING_TOKEN_TTL: 7 * 86400,
      RATE_LIMIT_PASSWORD_RESET_MAX: 3,
      // The window that 3 is *per*: ADR-0071 §4 gives this limiter an hour of
      // its own, where every other one takes the module's fixed 15 minutes.
      RATE_LIMIT_PASSWORD_RESET_WINDOW: 3600,
      // The mailbox's own budget over that same hour, and larger than the 3
      // above on purpose (ADR-0071 §4, amended at `D18.5`): at the same number
      // the per-sender limiter could never be the one to refuse, and one policy
      // would be written twice.
      RATE_LIMIT_MAILBOX_MAX: 5,
    });
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it("ceilings the two impersonation windows, which no other TTL is (ADR-0057)", () => {
    // The one number keeping "sixty seconds is all an onlooker gets" from
    // being a phrase: `60m` typed where `60s` was meant has to fail at
    // startup, not at the first incident.
    expect(() => parse({ IMPERSONATION_HANDOFF_TTL: "60m" })).toThrow(
      /IMPERSONATION_HANDOFF_TTL/,
    );
    expect(
      parse({ IMPERSONATION_HANDOFF_TTL: "5m" }).IMPERSONATION_HANDOFF_TTL,
    ).toBe(300);

    // And the one keeping the session's fixed end from being retired by a
    // value that leaves rotation-without-extension technically true.
    expect(() => parse({ IMPERSONATION_SESSION_TTL: "30d" })).toThrow(
      /IMPERSONATION_SESSION_TTL/,
    );
    expect(
      parse({ IMPERSONATION_SESSION_TTL: "12h" }).IMPERSONATION_SESSION_TTL,
    ).toBe(12 * 3600);
  });

  it("takes the argon2 defaults from @repo/crypto rather than restating them", () => {
    const env = parse();

    expect(env.ARGON2_MEMORY_KIB).toBe(defaultArgon2Params.memoryKib);
    expect(env.ARGON2_TIME_COST).toBe(defaultArgon2Params.timeCost);
    expect(env.ARGON2_PARALLELISM).toBe(defaultArgon2Params.parallelism);
  });

  it("rejects argon2 parameters below the OWASP floor", () => {
    expect(() =>
      parse({ ARGON2_MEMORY_KIB: String(minArgon2Params.memoryKib - 1) }),
    ).toThrow();
    expect(() =>
      parse({ ARGON2_TIME_COST: String(minArgon2Params.timeCost - 1) }),
    ).toThrow();
  });

  describe("boolean variables", () => {
    // ADR-0004 amendment: `z.coerce.boolean()` is `Boolean(value)` over a
    // string, so `=false` used to parse to `true` and the flag could not be
    // turned off. `z.stringbool()` is what makes these assertions pass.
    it.each([
      ["true", true],
      ["false", false],
      ["1", true],
      ["0", false],
      ["yes", true],
      ["no", false],
    ])("parses FEATURE_USER_REGISTRATION=%s as %s", (raw, expected) => {
      expect(
        parse({ FEATURE_USER_REGISTRATION: raw }).FEATURE_USER_REGISTRATION,
      ).toBe(expected);
    });

    it("rejects a typo instead of silently enabling the feature", () => {
      expect(() => parse({ FEATURE_USER_REGISTRATION: "flase" })).toThrow();
    });
  });

  it("splits and trims CORS_ORIGINS, dropping empties", () => {
    expect(
      parse({
        CORS_ORIGINS: " http://a.test , ,http://b.test ",
      }).CORS_ORIGINS,
    ).toEqual(["http://a.test", "http://b.test"]);
  });

  it("rejects a CORS entry that is not a URL", () => {
    // `credentials: true` makes every entry a credential-bearing cross-origin
    // grant, so a typo must fail at startup, not become a dead entry.
    expect(() => parse({ CORS_ORIGINS: "localhost:3001" })).toThrow(
      /CORS_ORIGINS/,
    );
  });

  it("requires a signing key of at least 32 characters", () => {
    expect(() => parse({ JWT_ACCESS_SECRET: "short" })).toThrow();
  });

  describe("production guards", () => {
    // `TRUST_PROXY`, `MAIL_TRANSPORT`, `METRICS_TOKEN` and the two app URLs
    // are stated here, not defaulted, so each guard below fails for its own
    // reason: since ADR-0059 §7 an unstated hop is itself a production
    // failure, since ADR-0066 §1–§2 so are an unstated mail transport and a
    // missing metrics token, and since ADR-0071 §1 so is an app URL left on
    // its development default — leaving any of them out would make every
    // assertion in this block pass for six reasons at once.
    const production = {
      NODE_ENV: "production",
      TRUST_PROXY: "1",
      MAIL_TRANSPORT: "log",
      METRICS_TOKEN: "m".repeat(32),
      CUSTOMER_APP_URL: "https://app.example.com",
      ADMIN_APP_URL: "https://admin.example.com",
    } as const;

    it.each(KNOWN_PUBLIC_SECRETS)(
      "refuses the signing key committed as %s",
      (secret) => {
        // Each is 32+ characters, so `min(32)` alone would let a key that is
        // public in this repository sign production access tokens.
        expect(secret.length).toBeGreaterThanOrEqual(32);
        expect(() =>
          parse({ ...production, JWT_ACCESS_SECRET: secret }),
        ).toThrow(/JWT_ACCESS_SECRET/);
      },
    );

    it('refuses TRUST_PROXY="true"', () => {
      // Express then takes the left-most X-Forwarded-For entry verbatim, which
      // makes `req.ip` attacker-controlled — and with it the login rate limit
      // and the session audit trail (ADR-0020).
      expect(() => parse({ ...production, TRUST_PROXY: "true" })).toThrow(
        /TRUST_PROXY/,
      );
    });

    it('refuses TRUST_PROXY="false" in production, so the hop is stated (ADR-0059 §7)', () => {
      // The other half of the refusal above, and the quieter one: behind a
      // reverse proxy that never set the variable, `req.ip` is the proxy's
      // address on every request — so the login limiter, the refresh limiter
      // and the audit trail collapse onto one key, in the permissive
      // direction, with nothing in any response to show for it.
      expect(() =>
        envSchema.parse({
          ...validEnv,
          NODE_ENV: "production",
          MAIL_TRANSPORT: "log",
          METRICS_TOKEN: "m".repeat(32),
          CUSTOMER_APP_URL: "https://app.example.com",
          ADMIN_APP_URL: "https://admin.example.com",
        }),
      ).toThrow(/TRUST_PROXY/);
      expect(() => parse({ ...production, TRUST_PROXY: "false" })).toThrow(
        /TRUST_PROXY/,
      );
    });

    it.each(["", "  ", "0", "+0", " 0 "])(
      "refuses %j, which resolves to the same instruction as false",
      (raw) => {
        // The check is on the resolved value, not the string, because these
        // are the spellings that happen *by themselves*: a zod default fires
        // only for `undefined`, so a compose file's `TRUST_PROXY=${TRUST_PROXY}`
        // turns an unset variable into `""`, and `"0"` is what an operator
        // told to "state a hop count" writes when there is no proxy. Express
        // reads all of them as "trust nothing" — exactly what `false` means.
        expect(() => parse({ ...production, TRUST_PROXY: raw })).toThrow(
          /TRUST_PROXY/,
        );
      },
    );

    it("leaves the default alone outside production", () => {
      // A developer's machine has no proxy in front of it, and the whole point
      // of the refusal is that it is production's to answer (ADR-0004).
      expect(parse().TRUST_PROXY).toBe("false");
      expect(() => parse({ NODE_ENV: "test" })).not.toThrow();
    });

    it("allows a hop count or a named proxy set", () => {
      expect(() => parse({ ...production, TRUST_PROXY: "2" })).not.toThrow();
      expect(() =>
        parse({ ...production, TRUST_PROXY: "loopback" }),
      ).not.toThrow();
    });

    it("allows the placeholder outside production", () => {
      expect(() =>
        parse({ JWT_ACCESS_SECRET: PLACEHOLDER_JWT_ACCESS_SECRET }),
      ).not.toThrow();
    });

    it("refuses a wildcard CORS origin (ADR-0020)", () => {
      expect(() => parse({ ...production, CORS_ORIGINS: "*" })).toThrow(
        /CORS_ORIGINS/,
      );
    });

    it("refuses either app URL left on its development default (ADR-0071 §1)", () => {
      // The API builds every link it mails out of these, so an inherited
      // localhost sends a verification or reset link into the recipient's own
      // machine — and nothing in a response or a log says so. Each is asserted
      // on its own, against a `production` that states the other, so neither
      // passes because of the other's refusal.
      expect(() =>
        parse({ ...production, CUSTOMER_APP_URL: LOCAL_CUSTOMER_APP_URL }),
      ).toThrow(/CUSTOMER_APP_URL/);
      expect(() =>
        parse({ ...production, ADMIN_APP_URL: LOCAL_ADMIN_APP_URL }),
      ).toThrow(/ADMIN_APP_URL/);
    });

    it.each([
      "http://localhost:3000",
      "http://127.0.0.1:3002",
      "http://[::1]:3002",
      "https://localhost:3002",
    ])("refuses %s, which is the same failure by another spelling", (url) => {
      // The reason the refusal reads the parsed URL rather than comparing
      // against the two committed defaults (`D18.1`'s `security-reviewer`):
      // an exact comparison refuses two strings and waves through every other
      // way of writing the recipient's own machine.
      expect(() => parse({ ...production, CUSTOMER_APP_URL: url })).toThrow(
        /CUSTOMER_APP_URL/,
      );
    });

    it("refuses a plain-http app origin in production, loopback or not", () => {
      // The half no comparison against a default could have caught. These
      // links carry a single-use token that can take an account over, in a
      // fragment: over http the whole URL sits in the browser bar and crosses
      // the network in the clear.
      expect(() =>
        parse({ ...production, CUSTOMER_APP_URL: "http://app.example.com" }),
      ).toThrow(/CUSTOMER_APP_URL/);
      expect(() =>
        parse({ ...production, ADMIN_APP_URL: "http://admin.internal" }),
      ).toThrow(/ADMIN_APP_URL/);
    });

    it("takes the two app URLs a real deployment states", () => {
      const env = parse(production);

      expect(env.CUSTOMER_APP_URL).toBe("https://app.example.com");
      expect(env.ADMIN_APP_URL).toBe("https://admin.example.com");
    });

    it("leaves both defaults alone outside production", () => {
      // The whole point of the refusal is that it is production's to answer
      // (ADR-0004): a developer's machine serves both SPAs on localhost.
      expect(parse().CUSTOMER_APP_URL).toBe(LOCAL_CUSTOMER_APP_URL);
      expect(parse().ADMIN_APP_URL).toBe(LOCAL_ADMIN_APP_URL);
      expect(() => parse({ NODE_ENV: "test" })).not.toThrow();
    });

    it("refuses an app URL that is not a bare origin", () => {
      // `originSchema`, for the reason CORS_ORIGINS uses it: `localhost:3002`
      // parses as a URL with `localhost:` for a scheme, and a trailing path
      // would be concatenated into every link the API mails.
      expect(() =>
        parse({ ...production, CUSTOMER_APP_URL: "app.example.com" }),
      ).toThrow(/CUSTOMER_APP_URL/);
      expect(() =>
        parse({ ...production, CUSTOMER_APP_URL: "https://app.example.com/" }),
      ).toThrow(/CUSTOMER_APP_URL/);
    });
  });
});

describe("toTrustProxy", () => {
  it.each([
    ["false", false],
    ["true", true],
    ["0", 0],
    ["2", 2],
    ["loopback", "loopback"],
    ["10.0.0.0/8,192.168.0.0/16", "10.0.0.0/8,192.168.0.0/16"],
  ])("maps %s to the Express setting %s", (raw, expected) => {
    expect(toTrustProxy(raw)).toBe(expected);
  });
});

describe("loadConfig", () => {
  it("groups the environment into the shape the app consumes", () => {
    const config = loadConfig({
      ...validEnv,
      NODE_ENV: "test",
      PORT: "5001",
      GIT_SHA: "a1b2c3d",
      CORS_ORIGINS: "http://localhost:3001",
    });

    expect(config.env).toBe("test");
    expect(config.isTest).toBe(true);
    expect(config.isProduction).toBe(false);
    expect(config.http).toMatchObject({ port: 5001, trustProxy: false });
    expect(config.app.commit).toBe("a1b2c3d");
    expect(config.db.url).toBe(validEnv.DATABASE_URL);
    expect(config.auth.argon2).toEqual(defaultArgon2Params);
  });

  it("carries the impersonation windows and the mint's own budget (ADR-0057)", () => {
    const config = loadConfig({
      ...validEnv,
      IMPERSONATION_SESSION_TTL: "45m",
      IMPERSONATION_HANDOFF_TTL: "30s",
      RATE_LIMIT_IMPERSONATION_MAX: "3",
    });

    expect(config.auth.impersonationSessionTtlSec).toBe(45 * 60);
    expect(config.auth.impersonationHandoffTtlSec).toBe(30);
    // A budget of its own, keyed on the staff principal rather than on an IP:
    // it must not be readable from, or confused with, the login limiter.
    expect(config.rateLimit.impersonationMax).toBe(3);
    expect(config.rateLimit.loginMax).toBe(10);
  });

  it("omits commit entirely when GIT_SHA is absent", () => {
    expect("commit" in loadConfig(validEnv).app).toBe(false);
  });

  it("freezes the result so nothing can rewrite configuration at runtime", () => {
    const config = loadConfig(validEnv);

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.auth)).toBe(true);
  });

  it("does not carry the seed credentials into the app config", () => {
    // They are validated (below) but never handed to the request path: only
    // the seed runner needs them (ADR-0008).
    const config = loadConfig({
      ...validEnv,
      SEED_SUPER_ADMIN_EMAIL: "admin@machxi.local",
      SEED_SUPER_ADMIN_PASSWORD: "ChangeMe123!local",
    });

    expect(JSON.stringify(config)).not.toContain("ChangeMe123!local");
  });

  it("validates the seed credentials it does not use", () => {
    expect(() =>
      loadConfig({ ...validEnv, SEED_SUPER_ADMIN_PASSWORD: "short" }),
    ).toThrow(/SEED_SUPER_ADMIN_PASSWORD/);
  });

  it("reports every offending key at once", () => {
    expect(() => loadConfig({ PORT: "-1" })).toThrow(
      /DATABASE_URL[\s\S]*JWT_ACCESS_SECRET/,
    );
  });

  it("never prints an offending value", () => {
    const secret = "this-would-be-a-leaked-secret";

    // A value that is present but wrong is the dangerous case: the key and the
    // constraint are safe to print, the value very often is not (ADR-0004).
    let message = "";

    try {
      loadConfig({ ...validEnv, PORT: secret });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("PORT");
    expect(message).not.toContain(secret);
  });
});

describe("formatConfigIssues", () => {
  it("renders one line per key, with the constraint but not the input", () => {
    const result = envSchema.safeParse({ PORT: "0" });

    expect(result.success).toBe(false);

    if (result.success) return;

    const lines = formatConfigIssues(result.error);

    expect(lines.some((line) => line.startsWith("PORT:"))).toBe(true);
    expect(lines.some((line) => line.startsWith("DATABASE_URL:"))).toBe(true);
  });
});

/**
 * ADR-0066: four seams, all off in a default clone, and two of them refused as
 * defaults in production.
 */
describe("the ADR-0066 seams", () => {
  it("reads an unstated MAIL_TRANSPORT as the log transport", () => {
    // A fresh clone and the whole test suite need no mail server, which is
    // what makes `log` the right default everywhere but production.
    expect(loadConfig(validEnv).mail.transport).toBe("log");
    expect(loadConfig(validEnv).mail.smtp).toMatchObject({
      host: "localhost",
      port: 1025,
      secure: false,
    });
  });

  it("requires production to state its transport", () => {
    const production = {
      ...validEnv,
      NODE_ENV: "production",
      TRUST_PROXY: "1",
      METRICS_TOKEN: "m".repeat(32),
      CUSTOMER_APP_URL: "https://app.example.com",
      ADMIN_APP_URL: "https://admin.example.com",
    };

    expect(() => loadConfig(production)).toThrow(/MAIL_TRANSPORT/);
    expect(
      loadConfig({ ...production, MAIL_TRANSPORT: "log" }).mail.transport,
    ).toBe("log");
  });

  it("requires production to set a metrics token", () => {
    const production = {
      ...validEnv,
      NODE_ENV: "production",
      TRUST_PROXY: "1",
      MAIL_TRANSPORT: "log",
      CUSTOMER_APP_URL: "https://app.example.com",
      ADMIN_APP_URL: "https://admin.example.com",
    };

    // The body is numbers, but the numbers name every route the API has.
    expect(() => loadConfig(production)).toThrow(/METRICS_TOKEN/);
    expect(() => loadConfig({ ...production, METRICS_TOKEN: "short" })).toThrow(
      /METRICS_TOKEN/,
    );
    expect(
      loadConfig({ ...production, METRICS_TOKEN: "m".repeat(32) }).metrics
        .token,
    ).toHaveLength(32);
  });

  it("refuses half a pair of SMTP credentials", () => {
    // nodemailer reads the *presence* of `auth` as "authenticate", so a
    // mistyped password variable would otherwise connect to the relay
    // unauthenticated instead of failing at startup.
    expect(() => loadConfig({ ...validEnv, SMTP_USER: "relay" })).toThrow(
      /SMTP_USER/,
    );
    expect(() => loadConfig({ ...validEnv, SMTP_PASSWORD: "s3cret" })).toThrow(
      /SMTP_USER/,
    );
    expect(
      loadConfig({ ...validEnv, SMTP_USER: "relay", SMTP_PASSWORD: "s3cret" })
        .mail.smtp.user,
    ).toBe("relay");
    // Neither is the default, and Mailpit authenticates nobody.
    expect(loadConfig(validEnv).mail.smtp.user).toBeUndefined();
  });

  it("reads a blank optional variable as absent, not as a malformed value", () => {
    // `REDIS_URL=` is how `.env.example` writes "set this if you have one",
    // and `KEY=${KEY}` in a compose file turns an unset variable into exactly
    // this on its way into a container.
    const config = loadConfig({
      ...validEnv,
      REDIS_URL: "",
      METRICS_TOKEN: "  ",
      ERROR_REPORTING_DSN: "",
    });

    expect(config.rateLimit.redisUrl).toBeUndefined();
    expect(config.metrics.token).toBeUndefined();
    expect(config.reporting.dsn).toBeUndefined();
  });

  it("constrains the schemes of the two URLs it is handed", () => {
    // Each is passed to a client that will open whatever it parses.
    expect(() =>
      loadConfig({ ...validEnv, REDIS_URL: "http://localhost:6379" }),
    ).toThrow(/REDIS_URL/);
    expect(() =>
      loadConfig({ ...validEnv, ERROR_REPORTING_DSN: "javascript:alert(1)" }),
    ).toThrow(/ERROR_REPORTING_DSN/);
    expect(
      loadConfig({ ...validEnv, REDIS_URL: "rediss://cache.internal:6379" })
        .rateLimit.redisUrl,
    ).toBe("rediss://cache.internal:6379");
  });
});

/**
 * ADR-0064 §1: the brand is one variable, and its default is what this
 * repository has always shipped.
 */
describe("APP_ID", () => {
  it("defaults to the brand every derived name already used", () => {
    expect(loadConfig(validEnv).app.id).toBe("machxi");
  });

  it("takes a fork's own identifier", () => {
    expect(loadConfig({ ...validEnv, APP_ID: "acme" }).app.id).toBe("acme");
    expect(loadConfig({ ...validEnv, APP_ID: "acme-eu" }).app.id).toBe(
      "acme-eu",
    );
  });

  it.each([
    // Every one of these would produce a name a browser refuses or reads as
    // two: RFC 6265 §4.1.1 forbids separators and whitespace in a cookie name,
    // and a `Set-Cookie` a browser drops is a deployment whose sessions simply
    // never persist. Failing at startup is the only place this can be caught.
    ["", "empty"],
    ["Acme", "uppercase, which a cookie name would read as a second brand"],
    ["acme corp", "whitespace"],
    ["acme.eu", "a separator"],
    ["acme;drop", "a cookie-pair separator"],
    ["-acme", "a leading hyphen, which reads as a truncation"],
    ["acme-", "a trailing hyphen"],
    ["a".repeat(33), "longer than the ceiling"],
  ])("refuses %j at startup (%s)", (value) => {
    expect(() => loadConfig({ ...validEnv, APP_ID: value })).toThrow(/APP_ID/);
  });
});
