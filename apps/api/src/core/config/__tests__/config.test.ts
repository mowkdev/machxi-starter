import { defaultArgon2Params, minArgon2Params } from "@repo/crypto";
import { describe, expect, it } from "vitest";

import {
  KNOWN_PUBLIC_SECRETS,
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
    const production = { NODE_ENV: "production" } as const;

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
