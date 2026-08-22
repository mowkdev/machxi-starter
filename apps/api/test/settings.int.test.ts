import {
  LOCALES,
  MAX_SETTINGS_GRIDS,
  THEMES,
  successEnvelopeSchema,
  type GridPreferencesV1,
} from "@repo/contracts";
import { staffSettings } from "@repo/db";
import { eq } from "drizzle-orm";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bearer,
  createStaffMember,
  createUserAccount,
  login,
  NEW_ACCOUNT_PASSWORD,
  type Tokens,
} from "./support/actors.js";
import { createTestApp, type TestApp } from "./support/app.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_STAFF,
  FIXTURE_USERS,
  resetAndSeed,
  superAdmin,
} from "./support/seed.js";
import { z } from "zod";

/**
 * `GET`/`PATCH /api/v1/{admin,user}/settings` (ADR-0045).
 *
 * One resource on two segments, so almost every assertion here is
 * parameterised by population rather than written twice — the point of the
 * module is that the two mounts differ only in which table they reach, and a
 * test that checked one of them would prove nothing about the other.
 *
 * What this file checks that the unit suite cannot: that the row really is
 * upserted and locked, that `grids` survives Postgres's `jsonb` unchanged,
 * that a staff member and a customer **sharing an email address** hold
 * separate settings, and that the hard delete cascades the row away — which
 * ADR-0045 says is a constraint's job and therefore has to be asserted rather
 * than trusted.
 */

const settingsResourceSchema = z.strictObject({
  theme: z.enum(THEMES),
  locale: z.enum(LOCALES),
  grids: z.record(z.string(), z.looseObject({ v: z.literal(1) })),
});

const settingsEnvelope = successEnvelopeSchema(settingsResourceSchema);

const SEGMENTS = [
  { population: "staff", path: "/api/v1/admin/settings" },
  { population: "user", path: "/api/v1/user/settings" },
] as const;

const arrangement = (width: number): GridPreferencesV1 => ({
  v: 1,
  sizing: { email: width },
  order: ["email", "status"],
  hidden: ["createdAt"],
});

describe("settings", () => {
  let harness: TestApp;
  let superAdminTokens: Tokens;
  /** One signed-in account per population, both acting only on themselves. */
  let tokensFor: Record<"staff" | "user", Tokens>;

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ db: harness.db, hasher: harness.container.hasher });

    superAdminTokens = await login(harness.app, "staff", superAdmin());

    tokensFor = {
      // An `editor` on purpose: the route carries no `authorize`, and the
      // least-privileged staff role must reach it (ADR-0019 §3, ADR-0045).
      staff: await login(harness.app, "staff", {
        email: FIXTURE_STAFF.editor,
        password: FIXTURE_PASSWORD,
      }),
      user: await login(harness.app, "user", {
        email: FIXTURE_USERS.active,
        password: FIXTURE_PASSWORD,
      }),
    };
  });

  afterAll(async () => {
    await harness.close();
  });

  const request = () => supertest(harness.app);

  const get = (population: "staff" | "user", path: string) =>
    request()
      .get(path)
      .set("Authorization", bearer(tokensFor[population].accessToken));

  const patch = (population: "staff" | "user", path: string, body: object) =>
    request()
      .patch(path)
      .set("Authorization", bearer(tokensFor[population].accessToken))
      .send(body);

  describe.each(SEGMENTS)("$path", ({ population, path }) => {
    it("answers the defaults before anything has ever been written", async () => {
      const response = await get(population, path).expect(200);

      expect(settingsEnvelope.safeParse(response.body).success).toBe(true);
      expect(response.body.data).toEqual({
        theme: "system",
        locale: "en",
        grids: {},
      });
    });

    it("never answers 404 — a principal always has settings", async () => {
      // The same claim as above, said as the thing a client must never have to
      // handle: there is no "you have no settings" state to distinguish from
      // "yours are the defaults".
      await get(population, path).expect(200);
    });

    it("creates the row on the first patch and returns the whole resource", async () => {
      const response = await patch(population, path, { theme: "dark" }).expect(
        200,
      );

      expect(settingsEnvelope.safeParse(response.body).success).toBe(true);
      expect(response.body.data).toEqual({
        theme: "dark",
        locale: "en",
        grids: {},
      });
      await expect(
        get(population, path).then((r) => r.body.data.theme),
      ).resolves.toBe("dark");
    });

    it("replaces a scalar and leaves the one the body did not name", async () => {
      await patch(population, path, { theme: "light", locale: "en" }).expect(
        200,
      );

      const response = await patch(population, path, { theme: "dark" }).expect(
        200,
      );

      expect(response.body.data).toMatchObject({ theme: "dark", locale: "en" });
    });

    it("stores the locale D7.1 appended, and hands it back (D7.1)", async () => {
      // The whole of the server-side change, asserted where it actually has
      // to hold: `LOCALES` feeds `z.enum` in the body *and* `pgEnum` in the
      // column, so a value the tuple gained must survive validation, the
      // `ALTER TYPE … ADD VALUE` of `0004_locale_lv`, and the read back.
      // Nothing in `apps/api/src` was touched to make this pass, which is the
      // claim ADR-0046 makes about the API and D7.5 checks as a diff.
      const written = await patch(population, path, { locale: "lv" }).expect(
        200,
      );

      expect(settingsEnvelope.safeParse(written.body).success).toBe(true);
      expect(written.body.data.locale).toBe("lv");

      const read = await get(population, path).expect(200);

      expect(read.body.data.locale).toBe("lv");

      // Back to the default, so the parameterised cases below this one keep
      // reading the resource they were written against.
      await patch(population, path, { locale: "en" }).expect(200);
    });

    it("merges grids per key, and a jsonb round trip changes nothing", async () => {
      await patch(population, path, {
        grids: { staff: arrangement(240) },
      }).expect(200);

      const response = await patch(population, path, {
        grids: { users: arrangement(300) },
      }).expect(200);

      // Both present: the second body said nothing about `staff`, and silence
      // cannot erase anything (ADR-0045 §Alternatives — the `PUT` this is not).
      expect(response.body.data.grids).toEqual({
        staff: arrangement(240),
        users: arrangement(300),
      });
    });

    it("deletes one entry on null and keeps the rest", async () => {
      await patch(population, path, {
        grids: { staff: arrangement(240), users: arrangement(300) },
      }).expect(200);

      const response = await patch(population, path, {
        grids: { staff: null },
      }).expect(200);

      expect(Object.keys(response.body.data.grids)).toEqual(["users"]);
    });

    it("takes an empty body as a no-op rather than a mistake", async () => {
      // A coalescing writer that flushes with nothing left to say is a race
      // the client should not have to detect (ADR-0045, amended D6.1).
      const before = await get(population, path).expect(200);
      const after = await patch(population, path, {}).expect(200);

      expect(after.body.data).toEqual(before.body.data);
    });

    it("refuses an unknown key rather than dropping it", async () => {
      const response = await patch(population, path, {
        them: "dark",
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("refuses a theme outside the enum", async () => {
      await patch(population, path, { theme: "sepia" }).expect(400);
    });

    it("refuses a grid entry whose width is outside the bounds, naming the path", async () => {
      const response = await patch(population, path, {
        grids: { staff: { ...arrangement(1), sizing: { email: 1 } } },
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(
        response.body.error.details.some((detail: { path?: string }) =>
          detail.path?.includes("grids"),
        ),
      ).toBe(true);
    });

    it("refuses a version it does not know", async () => {
      await patch(population, path, {
        grids: { staff: { ...arrangement(240), v: 2 } },
      }).expect(400);
    });

    it("refuses the grid that would take the row past its ceiling", async () => {
      // Self-contained: the tests above share this principal's row, so the
      // ceiling has to be reached from a known floor rather than from
      // whatever ran last. Clearing by `null` is also the delete rule doing
      // real work rather than being asserted once in isolation.
      const existing = await get(population, path).expect(200);

      await patch(population, path, {
        grids: Object.fromEntries(
          Object.keys(existing.body.data.grids as Record<string, unknown>).map(
            (gridId) => [gridId, null],
          ),
        ),
      }).expect(200);

      const full = Object.fromEntries(
        Array.from({ length: MAX_SETTINGS_GRIDS }, (_, i) => [
          `g${String(i)}`,
          arrangement(200),
        ]),
      );

      await patch(population, path, { grids: full }).expect(200);

      // A body of one grid — valid on its own, and invalid as a row. The bound
      // the body cannot check is the service's, inside the transaction.
      const response = await patch(population, path, {
        grids: { overflow: arrangement(200) },
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.body.error.details[0].path).toBe("grids");

      // And the refusal left nothing behind: the row still holds exactly the
      // grids it held before, so the insert-then-lock rolled back with it.
      const after = await get(population, path).expect(200);

      expect(Object.keys(after.body.data.grids)).toHaveLength(
        MAX_SETTINGS_GRIDS,
      );

      await patch(population, path, {
        grids: Object.fromEntries(
          Object.keys(full).map((gridId) => [gridId, null]),
        ),
      }).expect(200);
    });

    it("refuses an anonymous caller", async () => {
      await request().get(path).expect(401);
      await request().patch(path).send({ theme: "dark" }).expect(401);
    });

    it("refuses a token minted for the other population", async () => {
      const other = population === "staff" ? "user" : "staff";

      await request()
        .get(path)
        .set("Authorization", bearer(tokensFor[other].accessToken))
        .expect(401);
    });
  });

  it("keeps a staff member and a customer with the same address apart", async () => {
    // ADR-0017's two populations, at the settings layer: **one string, two
    // accounts, two tables** — which is what the pair of tables buys over the
    // `sessions` shape. Both sides are created here so the address really is
    // the same one, rather than two generated addresses that would prove only
    // that different accounts differ.
    const shared = `shared-settings-${String(Date.now())}@machxi.test`;

    await createStaffMember(harness.app, superAdminTokens.accessToken, {
      email: shared,
      firstName: "Shared",
      lastName: "Address",
      roles: ["editor"],
    });
    await createUserAccount(harness.app, superAdminTokens.accessToken, {
      email: shared,
    });

    const asStaff = await login(harness.app, "staff", {
      email: shared,
      password: NEW_ACCOUNT_PASSWORD,
    });
    const asCustomer = await login(harness.app, "user", {
      email: shared,
      password: NEW_ACCOUNT_PASSWORD,
    });

    await request()
      .patch("/api/v1/admin/settings")
      .set("Authorization", bearer(asStaff.accessToken))
      .send({ theme: "dark", grids: { staff: arrangement(111) } })
      .expect(200);
    await request()
      .patch("/api/v1/user/settings")
      .set("Authorization", bearer(asCustomer.accessToken))
      .send({ theme: "light", grids: { orders: arrangement(222) } })
      .expect(200);

    const staffSide = await request()
      .get("/api/v1/admin/settings")
      .set("Authorization", bearer(asStaff.accessToken))
      .expect(200);
    const customerSide = await request()
      .get("/api/v1/user/settings")
      .set("Authorization", bearer(asCustomer.accessToken))
      .expect(200);

    expect(staffSide.body.data.theme).toBe("dark");
    expect(Object.keys(staffSide.body.data.grids)).toEqual(["staff"]);
    expect(customerSide.body.data.theme).toBe("light");
    expect(Object.keys(customerSide.body.data.grids)).toEqual(["orders"]);
  });

  it("shows one staff member nothing of another's settings", async () => {
    // There is no `:id` on this resource, so there is no parameter to tamper
    // with — the assertion is that two signed-in accounts simply see their own
    // rows (ADR-0045 §Security).
    const otherEmail = `other-settings-${String(Date.now())}@machxi.test`;

    await createStaffMember(harness.app, superAdminTokens.accessToken, {
      email: otherEmail,
      firstName: "Other",
      lastName: "Operator",
      roles: ["editor"],
    });

    const otherTokens = await login(harness.app, "staff", {
      email: otherEmail,
      password: NEW_ACCOUNT_PASSWORD,
    });

    await request()
      .patch("/api/v1/admin/settings")
      .set("Authorization", bearer(otherTokens.accessToken))
      .send({ grids: { staff: arrangement(777) } })
      .expect(200);

    const mine = await get("staff", "/api/v1/admin/settings").expect(200);

    expect(JSON.stringify(mine.body.data)).not.toContain("777");
  });

  it("takes the settings row with a hard-deleted staff account", async () => {
    // ADR-0045 says the hard-delete path needs no settings code because the
    // foreign key cascades. That is a claim about a constraint, so it is
    // asserted here rather than trusted (ADR-0028 §Staff).
    const doomedEmail = `doomed-settings-${String(Date.now())}@machxi.test`;

    const doomed = await createStaffMember(
      harness.app,
      superAdminTokens.accessToken,
      {
        email: doomedEmail,
        firstName: "Doomed",
        lastName: "Operator",
        roles: ["editor"],
      },
    );

    const doomedTokens = await login(harness.app, "staff", {
      email: doomedEmail,
      password: NEW_ACCOUNT_PASSWORD,
    });

    await request()
      .patch("/api/v1/admin/settings")
      .set("Authorization", bearer(doomedTokens.accessToken))
      .send({ theme: "dark" })
      .expect(200);

    const before = await harness.db.db
      .select()
      .from(staffSettings)
      .where(eq(staffSettings.staffId, doomed.id));

    expect(before).toHaveLength(1);

    await request()
      .delete(`/api/v1/admin/staff/${doomed.id}`)
      .set("Authorization", bearer(superAdminTokens.accessToken))
      .expect(204);

    const after = await harness.db.db
      .select()
      .from(staffSettings)
      .where(eq(staffSettings.staffId, doomed.id));

    expect(after).toHaveLength(0);
  });

  it("hands a row hand-edited to garbage straight through, for the client to discard", async () => {
    // §Definition of done item 4's second half, at the tier this repository
    // can re-run. The browser's half of that item is that the grid renders at
    // its config defaults, and it only ever gets the chance to if `GET`
    // answers rather than throws: the API validates what it **writes**
    // (ADR-0011) and does not re-validate what it reads back, so a `jsonb`
    // column somebody edited round the outside is handed on exactly as it was
    // found. The guard is the client's schema, which discards the entry and
    // falls back to defaults (ADR-0041 `D4.5`, ADR-0045 §The server adapter) —
    // and that guard is unreachable if this request is a 500.
    const strayEmail = `stray-settings-${String(Date.now())}@machxi.test`;

    const stray = await createStaffMember(
      harness.app,
      superAdminTokens.accessToken,
      {
        email: strayEmail,
        firstName: "Stray",
        lastName: "Operator",
        roles: ["editor"],
      },
    );

    const strayTokens = await login(harness.app, "staff", {
      email: strayEmail,
      password: NEW_ACCOUNT_PASSWORD,
    });

    await request()
      .patch("/api/v1/admin/settings")
      .set("Authorization", bearer(strayTokens.accessToken))
      .send({ grids: { staff: arrangement(300) } })
      .expect(200);

    const garbage = { staff: { v: 2, nonsense: true } };

    await harness.db.db
      .update(staffSettings)
      .set({
        grids: garbage as unknown as Record<string, GridPreferencesV1>,
      })
      .where(eq(staffSettings.staffId, stray.id));

    const response = await request()
      .get("/api/v1/admin/settings")
      .set("Authorization", bearer(strayTokens.accessToken))
      .expect(200);

    expect(response.body.data.grids).toEqual(garbage);
  });

  it("leaks no credential through either segment", async () => {
    for (const { population, path } of SEGMENTS) {
      const response = await get(population, path).expect(200);

      expect(JSON.stringify(response.body)).not.toMatch(
        /\$argon2|passwordHash/,
      );
    }
  });
});
