import {
  declaredErrorEnvelopeSchema,
  successEnvelopeSchema,
} from "@repo/contracts";
import { staff } from "@repo/db";
import { eq } from "drizzle-orm";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createTestApp, type TestApp } from "./support/app.js";
import {
  REFRESH_COOKIE,
  TRANSPORTS,
  csrfCookie,
  cookieValue,
  setCookie,
  type TransportCase,
} from "./support/transport.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_STAFF,
  FIXTURE_USERS,
  resetAndSeed,
  superAdmin,
} from "./support/seed.js";

/**
 * The full authentication flow against a real Postgres, run **twice** — once
 * per population (ADR-0021: "same suite for user auth, shared test factory
 * parameterised by population").
 *
 * That parameterisation is the point rather than a convenience: ADR-0017 says
 * the two populations are served by one `createAuthService`, and the only way
 * to keep that true is for every assertion below to hold on both segments. A
 * rule that passes for staff and quietly fails for users is exactly the class
 * of bug the shared implementation exists to prevent.
 *
 * Since D2.5 it runs **four** times: transport is a second axis on the same
 * case object (ADR-0029 §Consequences), for the same reason. The flows must
 * not differ between a mobile client holding its refresh token in a keychain
 * and a browser holding it in a cookie it cannot read — only where the token
 * travels differs, and a rule that holds on `body` and quietly fails on
 * `cookie` is the same class of bug one axis lower.
 */

const authResource = successEnvelopeSchema(
  z.object({
    accessToken: z.string().min(1),
    accessTokenExpiresAt: z.iso.datetime(),
    // Optional since ADR-0029, and each transport asserts its own half of that
    // below: `body` that it is present, `cookie` that it is absent. Leaving it
    // required here would fail every cookie run for the right reason in the
    // wrong place.
    refreshToken: z.string().min(1).optional(),
    refreshTokenExpiresAt: z.iso.datetime(),
    tokenType: z.literal("Bearer"),
    principal: z.object({
      kind: z.enum(["staff", "user"]),
      id: z.uuid(),
      email: z.string(),
      roles: z.array(z.string()),
    }),
  }),
);

interface Credentials {
  readonly email: string;
  readonly password: string;
}

interface PopulationCase {
  readonly name: "staff" | "user";
  readonly base: string;
  readonly active: () => Credentials;
  /** An account that exists, has a correct password, and is not `active`. */
  readonly disabled: (harness: TestApp) => Promise<Credentials>;
}

const CASES: readonly PopulationCase[] = [
  {
    name: "staff",
    base: "/api/v1/admin/auth",
    active: superAdmin,
    // The staff fixtures are all `active` on purpose — there is no "disabled
    // staff" seeder — so this case makes one, which is also the state step 9's
    // `PATCH /admin/staff/:id` will produce.
    disabled: async (harness) => {
      await harness.db.db
        .update(staff)
        .set({ status: "disabled" })
        .where(eq(staff.email, FIXTURE_STAFF.editor));

      return { email: FIXTURE_STAFF.editor, password: FIXTURE_PASSWORD };
    },
  },
  {
    name: "user",
    base: "/api/v1/user/auth",
    active: () => ({
      email: FIXTURE_USERS.active,
      password: FIXTURE_PASSWORD,
    }),
    // Seeded disabled precisely so this path has something to test against
    // (ADR-0008 §dev fixtures).
    disabled: () =>
      Promise.resolve({
        email: FIXTURE_USERS.disabled,
        password: FIXTURE_PASSWORD,
      }),
  },
];

interface Run {
  readonly name: string;
  readonly population: PopulationCase;
  readonly transport: TransportCase;
}

const RUNS: readonly Run[] = CASES.flatMap((population) =>
  TRANSPORTS.map((transport) => ({
    name: `${population.name} over ${transport.name}`,
    population,
    transport,
  })),
);

describe.each(RUNS)("$name authentication", ({ population, transport }) => {
  /*
   * This population's CSRF cookie, named by ADR-0056 rather than shared.
   * Everything below reads the same way it did when there was one name; what
   * the run now proves is that each segment writes and checks its own.
   */
  const CSRF_COOKIE = csrfCookie(population.name);

  let harness: TestApp;

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ db: harness.db, hasher: harness.hasher });
  });

  afterAll(async () => {
    await harness.close();
  });

  const request = () => supertest(harness.app);

  const login = (credentials: Credentials = population.active()) =>
    transport.ask(request().post(`${population.base}/login`)).send(credentials);

  /**
   * Signs in and returns the access token plus whatever this transport gives a
   * client to refresh with — a string it will put in a body, or a pair of
   * cookies and the CSRF token it must echo.
   */
  const sessionFor = async (credentials?: Credentials) => {
    const response = await login(credentials).expect(200);

    return {
      accessToken: response.body.data.accessToken as string,
      carrier: transport.carry(response, population.name),
    } as const;
  };

  /** A `refresh` request presenting the credential the way this transport does. */
  const refreshWith = (carrier: ReturnType<typeof transport.carry>) =>
    carrier.present(
      transport.ask(request().post(`${population.base}/refresh`)),
    );

  describe("login", () => {
    it("returns a token pair and the principal", async () => {
      const response = await login().expect(200);

      expect(authResource.safeParse(response.body).success).toBe(true);
      expect(response.body.data.principal.kind).toBe(population.name);
      expect(response.body.data.principal.email).toBe(
        population.active().email,
      );
    });

    it("puts the refresh token where this transport says it goes", async () => {
      const response = await login().expect(200);

      if (transport.name === "body") {
        // D1's behaviour, unchanged, and the default for anyone who does not
        // ask: mobile clients, Postman, every existing caller.
        expect(response.body.data.refreshToken).toEqual(expect.any(String));
        expect(response.headers["set-cookie"]).toBeUndefined();

        return;
      }

      // The whole trade: what an XSS can read no longer includes a thirty-day
      // credential, because the credential is not in the response it can read.
      expect(response.body.data.refreshToken).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain(
        cookieValue(response, REFRESH_COOKIE) ?? "unreachable",
      );

      const refresh = setCookie(response, REFRESH_COOKIE);
      const csrf = setCookie(response, CSRF_COOKIE);

      expect(refresh).toMatch(/HttpOnly/i);
      expect(refresh).toMatch(/Secure/i);
      expect(refresh).toMatch(/SameSite=Strict/i);
      expect(refresh).toContain(`Path=${population.base}`);

      // Readable by script on purpose — the client echoes it back — and at
      // `Path=/` rather than its sibling's segment path, because
      // `document.cookie` only returns cookies matching the *document's* path
      // and no app is served from `/api/v1/admin/auth`. `__Host-` requires the
      // same `Path=/` and buys host-only in return (ADR-0029, amended D2.5).
      expect(csrf).not.toMatch(/HttpOnly/i);
      expect(csrf).toMatch(/Secure/i);
      expect(csrf).toMatch(/SameSite=Strict/i);
      expect(csrf).toContain("Path=/");
      expect(csrf).not.toContain(`Path=${population.base}`);

      // And in the body as well, for an app on a different host than the API,
      // which can never read the API's cookies at all.
      expect(response.body.data.csrfToken).toEqual(expect.any(String));

      // The expiry stays on the wire either way: knowing when the session ends
      // is useful to a client that cannot see the credential.
      expect(response.body.data.refreshTokenExpiresAt).toEqual(
        expect.any(String),
      );
    });

    it("never puts a password hash on the wire", async () => {
      // The mapper is the only thing standing between the row and the
      // response (ADR-0012); this asserts it, rather than trusting it.
      const response = await login().expect(200);

      expect(JSON.stringify(response.body)).not.toMatch(
        /\$argon2|passwordHash/,
      );
    });

    it("forbids caching the response that carries the tokens", async () => {
      await login().expect("Cache-Control", "no-store");
    });

    it("refuses a wrong password", async () => {
      const response = await login({
        email: population.active().email,
        password: "definitely-not-the-password",
      }).expect(401);

      expect(declaredErrorEnvelopeSchema.safeParse(response.body).success).toBe(
        true,
      );
      expect(response.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
    });

    it("answers an unknown address with the identical failure", async () => {
      // Same code, same status, same message: anything that differs is an
      // account-existence oracle (ADR-0018 §Login step 3).
      const wrongPassword = await login({
        email: population.active().email,
        password: "definitely-not-the-password",
      }).expect(401);

      const unknownEmail = await login({
        email: "nobody-at-all@machxi.local",
        password: "definitely-not-the-password",
      }).expect(401);

      expect(unknownEmail.body.error).toEqual(wrongPassword.body.error);
    });

    it("matches the address case-insensitively", async () => {
      // `email` is `citext` (ADR-0017), so the account is the same account.
      const response = await login({
        email: population.active().email.toUpperCase(),
        password: population.active().password,
      }).expect(200);

      expect(response.body.data.principal.email).toBe(
        population.active().email,
      );
    });

    it("refuses an account that is not active, with a distinct code", async () => {
      const credentials = await population.disabled(harness);
      const response = await login(credentials).expect(403);

      expect(response.body.error.code).toBe("AUTH_ACCOUNT_DISABLED");
    });

    it("rejects a malformed body as a validation error with field paths", async () => {
      const response = await request()
        .post(`${population.base}/login`)
        .send({ email: "not-an-email" })
        .expect(400);

      expect(declaredErrorEnvelopeSchema.safeParse(response.body).success).toBe(
        true,
      );
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(
        response.body.error.details.map((d: { path: string }) => d.path),
      ).toContain("password");
    });

    it("rejects an unknown field rather than ignoring it", async () => {
      // Bodies are `.strict()` (ADR-0020 §Input), so a typo surfaces instead
      // of silently doing nothing.
      const response = await request()
        .post(`${population.base}/login`)
        .send({ ...population.active(), isAdmin: true })
        .expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("me", () => {
    it("returns the principal, read fresh from the database", async () => {
      const { accessToken } = await sessionFor();

      const response = await request()
        .get(`${population.base}/me`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data.kind).toBe(population.name);
      expect(response.body.data.email).toBe(population.active().email);
      // `sessionId` is server-side only and must never reach a client
      // (ADR-0010).
      expect(response.body.data.sessionId).toBeUndefined();
    });

    it("refuses an absent token", async () => {
      const response = await request().get(`${population.base}/me`).expect(401);

      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("refuses a garbage token", async () => {
      const response = await request()
        .get(`${population.base}/me`)
        .set("Authorization", "Bearer not.a.jwt")
        .expect(401);

      expect(response.body.error.code).toBe("AUTH_TOKEN_INVALID");
    });
  });

  describe("refresh", () => {
    it("rotates the pair and the new access token works", async () => {
      const first = await sessionFor();

      const response = await refreshWith(first.carrier).expect(200);

      expect(authResource.safeParse(response.body).success).toBe(true);
      expect(response.body.data.principal.kind).toBe(population.name);

      // Rotation is rotation whatever carried the token: the value that comes
      // back is not the value that went out, and the service never learns
      // which one it was.
      const rotated = transport.carry(response, population.name);

      expect(rotated.token ?? cookieValue(response, REFRESH_COOKIE)).not.toBe(
        first.carrier.token ?? "body-transport-has-no-cookie",
      );

      await request()
        .get(`${population.base}/me`)
        .set("Authorization", `Bearer ${response.body.data.accessToken}`)
        .expect(200);
    });

    it("tolerates a replay inside the rotation grace window", async () => {
      // `REFRESH_ROTATION_GRACE_SEC` is 30 in `.env.test`, so an immediate
      // second call is the "two tabs / lost response" case, not an attack.
      const first = await sessionFor();

      await refreshWith(first.carrier).expect(200);
      await refreshWith(first.carrier).expect(200);
    });

    it("refuses an unknown refresh token", async () => {
      const unknown = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      const csrf = "csrf-value-that-matches-itself";

      const response = await (
        transport.name === "body"
          ? request()
              .post(`${population.base}/refresh`)
              .send({ refreshToken: unknown })
          : request()
              .post(`${population.base}/refresh`)
              .set("Cookie", [
                `${REFRESH_COOKIE}=${unknown}`,
                `${CSRF_COOKIE}=${csrf}`,
              ])
              .set("X-CSRF-Token", csrf)
      ).expect(401);

      // The CSRF check passes — the client did mean to send this — and the
      // token still does not exist. The two failures are different questions
      // and must not be answered with each other's code.
      expect(response.body.error.code).toBe("AUTH_INVALID_REFRESH_TOKEN");
    });
  });

  describe("logout", () => {
    it("answers 204 and immediately invalidates the access token", async () => {
      // This is what the per-request session lookup buys: revocation takes
      // effect now, not at the next token expiry (ADR-0018).
      const { accessToken, carrier } = await sessionFor();

      await carrier
        .present(request().post(`${population.base}/logout`))
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(204);

      const response = await request()
        .get(`${population.base}/me`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(401);

      expect(response.body.error.code).toBe("AUTH_SESSION_REVOKED");
    });

    it("kills the refresh token of the session it revoked", async () => {
      const { accessToken, carrier } = await sessionFor();

      await carrier
        .present(request().post(`${population.base}/logout`))
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(204);

      // Presenting the same credential again: the cookie the browser still
      // holds is worth exactly as little as the string a mobile client kept.
      const response = await refreshWith(carrier).expect(401);

      expect(response.body.error.code).toBe("AUTH_SESSION_REVOKED");
    });

    it("requires authentication", async () => {
      await request().post(`${population.base}/logout`).expect(401);
    });

    it("logout-all ends every other session too", async () => {
      const first = await sessionFor();
      const second = await sessionFor();

      await first.carrier
        .present(request().post(`${population.base}/logout-all`))
        .set("Authorization", `Bearer ${first.accessToken}`)
        .expect(204);

      await request()
        .get(`${population.base}/me`)
        .set("Authorization", `Bearer ${second.accessToken}`)
        .expect(401);
    });
  });
});

/**
 * Reuse detection needs the grace window closed, so it gets its own app built
 * with `refreshRotationGraceSec: 0` — the same wiring, one value changed.
 * Asserting it with the default window would mean sleeping 30 seconds in the
 * suite, and a test that sleeps is a test people delete.
 */
describe("refresh token reuse detection", () => {
  let harness: TestApp;

  beforeAll(async () => {
    harness = createTestApp({
      config: (config) => ({
        ...config,
        auth: { ...config.auth, refreshRotationGraceSec: 0 },
      }),
    });

    await resetAndSeed({ db: harness.db, hasher: harness.hasher });
  });

  afterAll(async () => {
    await harness.close();
  });

  const request = () => supertest(harness.app);

  it("revokes the session when a rotated token is replayed", async () => {
    const { email, password } = superAdmin();

    const login = await request()
      .post("/api/v1/admin/auth/login")
      .send({ email, password })
      .expect(200);

    const rotated = await request()
      .post("/api/v1/admin/auth/refresh")
      .send({ refreshToken: login.body.data.refreshToken })
      .expect(200);

    const replay = await request()
      .post("/api/v1/admin/auth/refresh")
      .send({ refreshToken: login.body.data.refreshToken })
      .expect(401);

    expect(replay.body.error.code).toBe("AUTH_REFRESH_REUSED");

    // The session is gone, not merely the replayed token: if the token was
    // stolen, the legitimate holder's session is what the thief uses next.
    const afterReuse = await request()
      .post("/api/v1/admin/auth/refresh")
      .send({ refreshToken: rotated.body.data.refreshToken })
      .expect(401);

    expect(afterReuse.body.error.code).toBe("AUTH_SESSION_REVOKED");

    await request()
      .get("/api/v1/admin/auth/me")
      .set("Authorization", `Bearer ${rotated.body.data.accessToken}`)
      .expect(401);
  });
});
