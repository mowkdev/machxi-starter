import {
  MAX_OFFSET,
  listEnvelopeSchema,
  stringifyListSearch,
} from "@repo/contracts";
import { users } from "@repo/db";
import { eq } from "drizzle-orm";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bearer,
  createUserAccount,
  listQueryString,
  login,
  type Tokens,
} from "./support/actors.js";
import { createTestApp, type TestApp } from "./support/app.js";
import {
  staffResourceSchema,
  userResourceSchema,
} from "./support/resources.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_STAFF,
  FIXTURE_USERS,
  resetAndSeed,
  superAdmin,
} from "./support/seed.js";

/**
 * The list-query language of ADR-0014, end to end on the two collections that
 * implement it.
 *
 * Everything here goes through a real query string, a real `qs` parse and real
 * SQL, because that is where this machinery can go wrong: the parser is unit
 * tested in `@repo/contracts` and `applyListQuery` is unit tested in
 * `core/http`, and neither of those can tell you that `filter[status][in]`
 * survives percent-encoding, that the tiebreaker keeps a page stable, or that
 * a `%` typed into a search box is a character rather than a wildcard.
 *
 * The caller is the seeded super admin throughout: who may reach these
 * endpoints is settled in `staff-admin` and `users-admin`, and repeating the
 * guard matrix here would only make a query-language failure look like an
 * authorization failure.
 */

const userListEnvelope = listEnvelopeSchema(userResourceSchema);
const staffListEnvelope = listEnvelopeSchema(staffResourceSchema);

const USERS_BASE = "/api/v1/admin/users";
const STAFF_BASE = "/api/v1/admin/staff";

/** Seeded (3) plus the three this file creates. */
const TOTAL_USERS = 6;
/** The super admin, the manager and the editor (ADR-0008 `--dev` fixtures). */
const TOTAL_STAFF = 3;

/** Names carrying a LIKE metacharacter, for the `escapeLikePattern` cases. */
const PERCENT_NAME = "100% Complete";
const UNDERSCORE_NAME = "Under_score";

describe("list queries (ADR-0014)", () => {
  let harness: TestApp;
  let tokens: Tokens;
  /** An instant after every seeded row and before every row created here. */
  let cutoff: string;

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ db: harness.db, hasher: harness.container.hasher });

    tokens = await login(harness.app, "staff", superAdmin());

    // Exactly one user has ever signed in, so `lastLoginAt` is a filterable
    // column with something on both sides of it.
    await login(harness.app, "user", {
      email: FIXTURE_USERS.active,
      password: FIXTURE_PASSWORD,
    });

    // Read the boundary from the API rather than from this process's clock:
    // the rows were written by Postgres' `now()`, and a `new Date()` here
    // would be a second clock to disagree with.
    const seeded = await supertest(harness.app)
      .get(`${USERS_BASE}?${listQueryString({ limit: 1 })}`)
      .set("Authorization", bearer(tokens.accessToken))
      .expect(200);

    cutoff = new Date(
      new Date(seeded.body.data[0].createdAt as string).getTime() + 1,
    ).toISOString();

    for (const fixture of [
      { email: "zoe@example.com", firstName: "Zoe", lastName: "Zephyr" },
      {
        email: "percent@example.com",
        firstName: PERCENT_NAME,
        lastName: "Ing",
      },
      {
        email: "underscore@example.com",
        firstName: UNDERSCORE_NAME,
        lastName: "Mark",
      },
    ]) {
      await createUserAccount(harness.app, tokens.accessToken, fixture);
    }
  });

  afterAll(async () => {
    await harness.close();
  });

  const request = () => supertest(harness.app);

  const list = (base: string, params: Record<string, string | number> = {}) => {
    const query = listQueryString(params);

    return request()
      .get(query === "" ? base : `${base}?${query}`)
      .set("Authorization", bearer(tokens.accessToken));
  };

  const emailsOf = (body: { data: { email: string }[] }): string[] =>
    body.data.map((item) => item.email);

  describe("the default page", () => {
    it("applies the documented defaults and echoes them in meta", async () => {
      const response = await list(USERS_BASE).expect(200);

      expect(userListEnvelope.safeParse(response.body).success).toBe(true);
      expect(response.body.meta.pagination).toEqual({
        offset: 0,
        limit: 20,
        total: TOTAL_USERS,
      });
      expect(response.body.data).toHaveLength(TOTAL_USERS);
      expect(response.body.meta.requestId).toEqual(expect.any(String));
    });

    it("reports the resolved sort without the tiebreaker", async () => {
      // `id asc` is appended to every ORDER BY so that pages are stable, but
      // it is a statement about SQL, not about what the client asked for —
      // echoing it would make `meta.sort` unusable as table state.
      const response = await list(USERS_BASE).expect(200);

      expect(response.body.meta.sort).toEqual([
        { field: "createdAt", direction: "desc" },
      ]);
    });

    it("omits meta.filters entirely when nothing was filtered", async () => {
      // The key's presence means something (ADR-0012), so an empty object
      // would be a different claim from no filter at all.
      const response = await list(USERS_BASE).expect(200);

      expect(response.body.meta.filters).toBeUndefined();
    });

    it("applies the same defaults on the staff collection", async () => {
      const response = await list(STAFF_BASE).expect(200);

      expect(staffListEnvelope.safeParse(response.body).success).toBe(true);
      expect(response.body.meta.pagination).toEqual({
        offset: 0,
        limit: 20,
        total: TOTAL_STAFF,
      });
      expect(response.body.meta.sort).toEqual([
        { field: "createdAt", direction: "desc" },
      ]);
    });
  });

  describe("pagination", () => {
    it("returns the requested window and the unwindowed total", async () => {
      const first = await list(USERS_BASE, { limit: 2 }).expect(200);
      const second = await list(USERS_BASE, { offset: 2, limit: 2 }).expect(
        200,
      );

      expect(first.body.data).toHaveLength(2);
      expect(second.body.data).toHaveLength(2);
      expect(first.body.meta.pagination).toEqual({
        offset: 0,
        limit: 2,
        total: TOTAL_USERS,
      });
      expect(second.body.meta.pagination.offset).toBe(2);
      // `total` counts what the filter matches, not what the page holds.
      expect(second.body.meta.pagination.total).toBe(TOTAL_USERS);
      // Windows, not repeats: the second page must be new rows.
      const overlap = emailsOf(first.body).filter((email) =>
        emailsOf(second.body).includes(email),
      );

      expect(overlap).toEqual([]);
    });

    it("returns an empty page past the end, with the total intact", async () => {
      const response = await list(USERS_BASE, { offset: 100 }).expect(200);

      expect(response.body.data).toEqual([]);
      expect(response.body.meta.pagination.total).toBe(TOTAL_USERS);
    });

    it("rejects limit=0", async () => {
      // A page of nothing is a request that cannot be answered usefully, and
      // the schema's floor is what stops it becoming a count-only endpoint.
      const response = await list(USERS_BASE, { limit: 0 }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(
        response.body.error.details.map((d: { path: string }) => d.path),
      ).toContain("limit");
    });

    it("rejects a limit above the shared ceiling", async () => {
      // MAX_LIMIT is 100: the ceiling is what keeps one request from turning
      // into a table scan plus a megabyte of JSON (ADR-0014, ADR-0020).
      const response = await list(USERS_BASE, { limit: 101 }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects a negative offset", async () => {
      const response = await list(USERS_BASE, { offset: -1 }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects an offset past the ceiling (ADR-0060 §1)", async () => {
      // `?offset=50000000` used to be a legal request that Postgres answered
      // by walking fifty million rows. `400`, not a special case in a
      // controller: it is the same bound, spelled the same way, as the
      // `limit` ceiling two cases above (ADR-0013 gives VALIDATION_ERROR its
      // status).
      const response = await list(USERS_BASE, {
        offset: MAX_OFFSET + 1,
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(
        response.body.error.details.map((d: { path: string }) => d.path),
      ).toContain("offset");
    });

    it("allows the ceiling itself", async () => {
      const response = await list(USERS_BASE, { offset: MAX_OFFSET }).expect(
        200,
      );

      expect(response.body.data).toEqual([]);
      expect(response.body.meta.pagination.offset).toBe(MAX_OFFSET);
    });

    it("rejects an unknown query parameter", async () => {
      // The query schema is strict, so `?page=2` is a typo that is reported
      // rather than silently ignored (ADR-0011).
      const response = await list(USERS_BASE, { page: 2 }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("sorting", () => {
    it("orders by a single ascending field", async () => {
      const response = await list(USERS_BASE, { sort: "email" }).expect(200);

      const emails = emailsOf(response.body);

      expect(emails).toEqual([...emails].sort());
      expect(response.body.meta.sort).toEqual([
        { field: "email", direction: "asc" },
      ]);
    });

    it("orders by several fields, direction per field", async () => {
      const response = await list(USERS_BASE, {
        sort: "-email,firstName",
      }).expect(200);

      const emails = emailsOf(response.body);

      expect(emails).toEqual([...emails].sort().reverse());
      expect(response.body.meta.sort).toEqual([
        { field: "email", direction: "desc" },
        { field: "firstName", direction: "asc" },
      ]);
    });

    it("sorts the staff collection the same way", async () => {
      const response = await list(STAFF_BASE, { sort: "email" }).expect(200);

      const emails = emailsOf(response.body);

      expect(emails).toEqual([...emails].sort());
      expect(emails).toContain(FIXTURE_STAFF.editor);
    });

    it("rejects a field that is not in the sortable allow-list", async () => {
      // The allow-list is what keeps clients off non-indexed and sensitive
      // columns; `passwordHash` is the reason it is an allow-list and not a
      // deny-list (ADR-0014).
      const response = await list(USERS_BASE, {
        sort: "passwordHash",
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(
        response.body.error.details.map((d: { path: string }) => d.path),
      ).toContain("sort");
    });

    it("rejects an unknown sort field on the staff collection too", async () => {
      const response = await list(STAFF_BASE, { sort: "-nope" }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("keeps a page stable when the sort key ties", async () => {
      // Four accounts share `status = active`, so without the `id asc`
      // tiebreaker the database is free to return them in any order — and an
      // offset paginator would then show one row twice and skip another.
      const pages: string[] = [];

      for (const offset of [0, 2, 4]) {
        const page = await list(USERS_BASE, {
          sort: "status",
          offset,
          limit: 2,
        }).expect(200);

        pages.push(...page.body.data.map((item: { id: string }) => item.id));
      }

      expect(new Set(pages).size).toBe(TOTAL_USERS);

      const wholeList = await list(USERS_BASE, { sort: "status" }).expect(200);

      expect(pages).toEqual(
        wholeList.body.data.map((item: { id: string }) => item.id),
      );
    });
  });

  describe("filtering", () => {
    it("filters by equality and echoes the field unadorned", async () => {
      const response = await list(USERS_BASE, {
        "filter[status]": "active",
      }).expect(200);

      const statuses = response.body.data.map(
        (item: { status: string }) => item.status,
      );

      expect(statuses).not.toHaveLength(0);
      expect(new Set(statuses)).toEqual(new Set(["active"]));
      // `eq` is the default operator, so the key carries no suffix — it is the
      // query string that produced it (ADR-0012).
      expect(response.body.meta.filters).toEqual({ status: "active" });
      expect(response.body.meta.pagination.total).toBe(statuses.length);
    });

    it("accepts the literal brackets a client's canonical query string writes", async () => {
      /*
       * ADR-0043 makes one string serve the address bar and the wire, and it
       * writes `filter[status]` rather than `filter%5Bstatus%5D` because a URL
       * an operator can read is the point of that decision. The two are the
       * same query once decoded — which is a claim about `qs` and Express, so
       * it is checked here against a real request rather than reasoned about
       * in the package that produces the string.
       *
       * Built with the contracts writer itself, so this fails if the canonical
       * spelling ever changes underneath the API.
       */
      const canonical = stringifyListSearch({
        offset: 0,
        limit: 20,
        sort: [{ field: "email", direction: "asc" }],
        filters: [{ field: "status", op: "in", value: ["active", "disabled"] }],
      });

      expect(canonical).toContain("filter[status][in]=");

      const response = await request()
        .get(`${USERS_BASE}?${canonical}`)
        .set("Authorization", bearer(tokens.accessToken))
        .expect(200);

      const encoded = await list(USERS_BASE, {
        offset: 0,
        limit: 20,
        sort: "email",
        "filter[status][in]": "active,disabled",
      }).expect(200);

      // Same rows, same echo, same total: one query, two spellings.
      expect(response.body.data).toEqual(encoded.body.data);
      expect(response.body.meta.filters).toEqual({
        "status[in]": ["active", "disabled"],
      });
    });

    it("filters by a list and echoes the parsed members", async () => {
      const response = await list(USERS_BASE, {
        "filter[status][in]": "active,disabled",
      }).expect(200);

      const statuses = new Set(
        response.body.data.map((item: { status: string }) => item.status),
      );

      expect(statuses.has("pending_verification")).toBe(false);
      expect(statuses.has("disabled")).toBe(true);
      expect(response.body.meta.filters).toEqual({
        "status[in]": ["active", "disabled"],
      });
    });

    it("filters by an ILIKE pattern the client supplies", async () => {
      // Unlike `q`, `like` is a pattern by contract: `%` is the client's
      // wildcard and is passed through untouched.
      const response = await list(USERS_BASE, {
        "filter[email][like]": "%machxi.local",
      }).expect(200);

      expect(emailsOf(response.body).sort()).toEqual([
        FIXTURE_USERS.active,
        FIXTURE_USERS.disabled,
        FIXTURE_USERS.pending,
      ]);
      expect(response.body.meta.filters).toEqual({
        "email[like]": "%machxi.local",
      });
    });

    it("filters by a date range", async () => {
      const response = await list(USERS_BASE, {
        "filter[createdAt][gte]": cutoff,
      }).expect(200);

      expect(emailsOf(response.body).sort()).toEqual([
        "percent@example.com",
        "underscore@example.com",
        "zoe@example.com",
      ]);
      // The echo is the *parsed* value — a `Date`, because the column is a
      // timestamp and Drizzle binds through the column's driver mapper — so it
      // comes back as the ISO instant, not as the string that was sent.
      expect(response.body.meta.filters).toEqual({
        "createdAt[gte]": new Date(cutoff).toISOString(),
      });
    });

    it("filters by the presence of a nullable column", async () => {
      const neverSignedIn = await list(USERS_BASE, {
        "filter[lastLoginAt][null]": "true",
      }).expect(200);

      const signedIn = await list(USERS_BASE, {
        "filter[lastLoginAt][null]": "false",
      }).expect(200);

      expect(emailsOf(neverSignedIn.body)).not.toContain(FIXTURE_USERS.active);
      expect(emailsOf(signedIn.body)).toEqual([FIXTURE_USERS.active]);
      expect(neverSignedIn.body.meta.pagination.total).toBe(TOTAL_USERS - 1);
      // The parsed value is a boolean, not the string that was sent.
      expect(signedIn.body.meta.filters).toEqual({
        "lastLoginAt[null]": false,
      });
    });

    it("combines filters, search and sort in one request", async () => {
      const response = await list(USERS_BASE, {
        "filter[status]": "active",
        q: "example.com",
        sort: "email",
      }).expect(200);

      expect(emailsOf(response.body)).toEqual([
        "percent@example.com",
        "underscore@example.com",
        "zoe@example.com",
      ]);
    });

    it("filters the staff collection by status", async () => {
      const response = await list(STAFF_BASE, {
        "filter[status][in]": "active,invited",
      }).expect(200);

      expect(response.body.meta.pagination.total).toBe(TOTAL_STAFF);
    });

    it("rejects a field that is not filterable", async () => {
      const response = await list(USERS_BASE, {
        "filter[passwordHash]": "anything",
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects an operator the field does not allow", async () => {
      // `status` is an enum: an ILIKE against it is either a mistake or a
      // probe, and either way the allow-list decides per field, not globally.
      const response = await list(USERS_BASE, {
        "filter[status][like]": "%act%",
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects a value that is not of the field's type", async () => {
      const response = await list(USERS_BASE, {
        "filter[status]": "retired",
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects deletedAt on the staff collection, which has no such column", async () => {
      // The allow-list is per endpoint, so a filter that is legitimate on
      // `/admin/users` is simply unknown here (ADR-0017: only `users` is
      // soft-deletable).
      const response = await list(STAFF_BASE, {
        "filter[deletedAt][null]": "false",
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("free-text search", () => {
    it("matches email, first name and last name, case-insensitively", async () => {
      const byEmail = await list(USERS_BASE, { q: "machxi" }).expect(200);
      const byFirstName = await list(USERS_BASE, { q: "zoe" }).expect(200);
      const byLastName = await list(USERS_BASE, { q: "ZEPHYR" }).expect(200);

      expect(byEmail.body.meta.pagination.total).toBe(3);
      expect(emailsOf(byFirstName.body)).toEqual(["zoe@example.com"]);
      expect(emailsOf(byLastName.body)).toEqual(["zoe@example.com"]);
    });

    it("treats % in the term as a character, not as a wildcard", async () => {
      // `escapeLikePattern`. Without it the pattern becomes `%%%`, every row
      // matches, and a search box quietly turns into a full table scan that
      // returns the whole table — a failure that looks like a feature.
      const response = await list(USERS_BASE, { q: "%" }).expect(200);

      expect(emailsOf(response.body)).toEqual(["percent@example.com"]);
      expect(response.body.meta.pagination.total).toBe(1);
      expect(response.body.data[0].firstName).toBe(PERCENT_NAME);
    });

    it("treats _ in the term as a character, not as a single-character wildcard", async () => {
      const response = await list(USERS_BASE, { q: "_" }).expect(200);

      expect(emailsOf(response.body)).toEqual(["underscore@example.com"]);
      expect(response.body.data[0].firstName).toBe(UNDERSCORE_NAME);
    });

    it("matches a term that mixes a metacharacter with text", async () => {
      const response = await list(USERS_BASE, { q: "100% comp" }).expect(200);

      expect(emailsOf(response.body)).toEqual(["percent@example.com"]);
    });

    it("returns an empty page rather than an error when nothing matches", async () => {
      const response = await list(USERS_BASE, { q: "nobody-here" }).expect(200);

      expect(response.body.data).toEqual([]);
      expect(response.body.meta.pagination.total).toBe(0);
    });

    it("searches the staff collection too", async () => {
      const response = await list(STAFF_BASE, { q: "editor" }).expect(200);

      expect(emailsOf(response.body)).toEqual([FIXTURE_STAFF.editor]);
    });
  });

  /**
   * Soft delete (ADR-0017), last in the file because it takes a row out of
   * every default page above it.
   */
  describe("soft-deleted rows", () => {
    let deletedEmail: string;

    beforeAll(async () => {
      deletedEmail = "deleted@example.com";

      const created = await createUserAccount(harness.app, tokens.accessToken, {
        email: deletedEmail,
        firstName: "Gone",
        lastName: "Away",
      });

      // Nothing on the API sets this yet — the delete endpoint is a later
      // step — but the read paths that have to respect it exist now.
      await harness.db.db
        .update(users)
        .set({ deletedAt: new Date() })
        .where(eq(users.id, created.id));
    });

    it("are hidden from the default list", async () => {
      const response = await list(USERS_BASE).expect(200);

      expect(emailsOf(response.body)).not.toContain(deletedEmail);
      expect(response.body.meta.pagination.total).toBe(TOTAL_USERS);
    });

    it("are the only rows returned when asked for by absence", async () => {
      // The default scope steps aside as soon as the query mentions
      // `deletedAt`: an allow-listed filter that could never match anything
      // would be a lie in the allow-list.
      const response = await list(USERS_BASE, {
        "filter[deletedAt][null]": "false",
      }).expect(200);

      expect(emailsOf(response.body)).toEqual([deletedEmail]);
      expect(response.body.meta.filters).toEqual({ "deletedAt[null]": false });
    });

    it("are excluded again when the filter asks for live rows", async () => {
      const response = await list(USERS_BASE, {
        "filter[deletedAt][null]": "true",
      }).expect(200);

      expect(emailsOf(response.body)).not.toContain(deletedEmail);
      expect(response.body.meta.pagination.total).toBe(TOTAL_USERS);
    });

    it("stay hidden from free-text search", async () => {
      const response = await list(USERS_BASE, { q: "Gone" }).expect(200);

      expect(response.body.data).toEqual([]);
    });
  });

  describe("the count flag (ADR-0060 §2)", () => {
    it("answers total: null with the same items the counted page returns", async () => {
      const counted = await list(USERS_BASE, { limit: 3 }).expect(200);
      const declined = await list(USERS_BASE, {
        limit: 3,
        count: "false",
      }).expect(200);

      // The page is the same page — same rows, same order, same offset and
      // limit. The only difference is the number the caller declined.
      expect(emailsOf(declined.body)).toEqual(emailsOf(counted.body));
      expect(counted.body.meta.pagination.total).toBe(TOTAL_USERS);
      expect(declined.body.meta.pagination.total).toBeNull();
      expect(declined.body.meta.pagination.offset).toBe(0);
      expect(declined.body.meta.pagination.limit).toBe(3);
      expect(userListEnvelope.safeParse(declined.body).success).toBe(true);
    });

    it("still counts when the client says nothing", async () => {
      const response = await list(USERS_BASE, { count: "true" }).expect(200);

      expect(response.body.meta.pagination.total).toBe(TOTAL_USERS);
    });

    it("declines the count on staff too, filters and all", async () => {
      const response = await list(STAFF_BASE, {
        "filter[status]": "active",
        count: "false",
      }).expect(200);

      expect(response.body.meta.pagination.total).toBeNull();
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(staffListEnvelope.safeParse(response.body).success).toBe(true);
    });

    it("takes the two words and nothing else", async () => {
      const response = await list(USERS_BASE, { count: "0" }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });
});
