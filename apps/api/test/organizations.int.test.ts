import {
  organizationInvitations,
  organizationMemberships,
  setTenantScope,
  users,
  type DbExecutor,
} from "@repo/db";
import { eq, sql } from "drizzle-orm";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bearer,
  login,
  NEW_ACCOUNT_PASSWORD,
  type Tokens,
} from "./support/actors.js";
import {
  createRequestContext,
  runWithContext,
  type RequestContext,
} from "../src/core/context/index.js";
import { createDb, openInRequestScope } from "../src/core/db/index.js";
import { createTestApp, type TestApp } from "./support/app.js";
import { lastMailTo, registerVerified, tokenFromMail } from "./support/mail.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_USERS,
  resetAndSeed,
  superAdmin,
} from "./support/seed.js";

/**
 * `/api/v1/user/orgs` and `/api/v1/user/invitations` end to end (ADR-0067 §2,
 * §4; ADR-0021).
 *
 * The resource whose guard is a **membership** rather than a role, so the
 * matrix this file draws is different from every other one: the same request
 * from three callers — a stranger, a member, an owner — has to answer `404`,
 * `403` and `200`, and the difference between the first two is the whole of
 * ADR-0067 §4's "a non-member is not told it exists".
 */

const ORGS = "/api/v1/user/orgs";
const INVITATIONS = "/api/v1/user/invitations";

describe("organizations on the user segment", () => {
  let harness: TestApp;
  let owner: Tokens;
  let stranger: Tokens;
  let ownerId: string;
  let strangerId: string;
  let orgId: string;

  const request = () => supertest(harness.app);

  /**
   * Signs a fresh account in and returns its id and its tokens.
   *
   * Two steps since ADR-0071 §3 rather than one: registration issues no
   * session, so the account is created and its mailed link walked — exactly
   * what a person does. `registerVerified` reads the link out of the captured
   * messages.
   */
  const freshAccount = (
    email: string,
  ): Promise<{ id: string; tokens: Tokens; email: string }> =>
    registerVerified(harness, email, NEW_ACCOUNT_PASSWORD);

  const createTeam = async (token: string, slug: string, name = "A Team") => {
    const response = await request()
      .post(ORGS)
      .set("Authorization", bearer(token))
      .send({ name, slug })
      .expect(201);

    return response.body.data as { id: string; slug: string; role: string };
  };

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ hasher: harness.hasher });

    owner = await login(harness.app, "user", {
      email: FIXTURE_USERS.active,
      password: FIXTURE_PASSWORD,
    });

    const me = await request()
      .get("/api/v1/user/auth/me")
      .set("Authorization", bearer(owner.accessToken))
      .expect(200);

    ownerId = me.body.data.id as string;

    const outsider = await freshAccount("stranger@machxi.local");

    stranger = outsider.tokens;
    strangerId = outsider.id;

    const acme = await request()
      .get(ORGS)
      .set("Authorization", bearer(owner.accessToken))
      .expect(200);

    orgId = (acme.body.data as { id: string; slug: string }[]).find(
      (row) => row.slug === "acme",
    )!.id;
  });

  afterAll(async () => {
    await harness.close();
  });

  /* ── GET /user/orgs — the switcher's query ──────────────────────────────── */

  describe("GET /api/v1/user/orgs", () => {
    it("lists the caller's own organizations, each with their role", async () => {
      const response = await request()
        .get(ORGS)
        .set("Authorization", bearer(owner.accessToken))
        .expect(200);

      const rows = response.body.data as {
        slug: string;
        kind: string;
        role: string;
      }[];

      // Every live account has at least its personal organization
      // (ADR-0067 §2), which is what lets a switcher have no empty state.
      expect(rows.some((row) => row.kind === "personal")).toBe(true);
      expect(rows.find((row) => row.slug === "acme")?.role).toBe("owner");
    });

    it("shows a fresh account exactly one organization, its own", async () => {
      const response = await request()
        .get(ORGS)
        .set("Authorization", bearer(stranger.accessToken))
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        kind: "personal",
        role: "owner",
      });
    });

    it("refuses an anonymous caller", async () => {
      await request().get(ORGS).expect(401);
    });
  });

  /* ── the membership guard (ADR-0067 §4) ─────────────────────────────────── */

  describe("requireMembership, on the wire", () => {
    it("answers a non-member 404, not 403", async () => {
      const response = await request()
        .get(`${ORGS}/${orgId}`)
        .set("Authorization", bearer(stranger.accessToken))
        .expect(404);

      // The same code an organization that does not exist gets: existence is
      // not disclosed to somebody outside it.
      expect(response.body.error.code).toBe("NOT_FOUND");

      const absent = await request()
        .get(`${ORGS}/00000000-0000-4000-8000-000000000000`)
        .set("Authorization", bearer(stranger.accessToken))
        .expect(404);

      expect(absent.body.error.code).toBe(response.body.error.code);
      expect(absent.body.error.message).toBe(response.body.error.message);
    });

    it("answers a malformed organization id 404, never 400", async () => {
      const response = await request()
        .get(`${ORGS}/not-a-uuid`)
        .set("Authorization", bearer(owner.accessToken))
        .expect(404);

      expect(response.body.error.code).toBe("NOT_FOUND");
    });

    it("lets a member read, and reports the role that got them there", async () => {
      const response = await request()
        .get(`${ORGS}/${orgId}`)
        .set("Authorization", bearer(owner.accessToken))
        .expect(200);

      expect(response.body.data).toMatchObject({
        slug: "acme",
        kind: "team",
        role: "owner",
      });
    });

    it("answers a member below the required role 403", async () => {
      const org = await createTeam(owner.accessToken, "guard-role-probe");
      const member = await freshAccount("guard.member@machxi.local");

      await joinAsMember(org.id, member);

      // A member may read the organization…
      await request()
        .get(`${ORGS}/${org.id}`)
        .set("Authorization", bearer(member.tokens.accessToken))
        .expect(200);

      // …and not edit it: `403`, because the caller is inside and may know it
      // exists — the difference from the `404` above.
      const refused = await request()
        .patch(`${ORGS}/${org.id}`)
        .set("Authorization", bearer(member.tokens.accessToken))
        .send({ name: "Renamed by a member" })
        .expect(403);

      expect(refused.body.error.code).toBe("FORBIDDEN");
    });
  });

  /** Invites an account and accepts, which is the only way to add a member. */
  const joinAsMember = async (
    organizationId: string,
    account: { email: string; tokens: Tokens },
    role: "admin" | "member" = "member",
  ): Promise<void> => {
    await request()
      .post(`${ORGS}/${organizationId}/invitations`)
      .set("Authorization", bearer(owner.accessToken))
      .send({ email: account.email, role })
      .expect(201);

    const pending = await request()
      .get(INVITATIONS)
      .set("Authorization", bearer(account.tokens.accessToken))
      .expect(200);

    const invitation = (
      pending.body.data as { id: string; organizationId: string }[]
    ).find((row) => row.organizationId === organizationId);

    await request()
      .post(`${INVITATIONS}/${invitation?.id ?? ""}/accept`)
      .set("Authorization", bearer(account.tokens.accessToken))
      .expect(200);
  };

  /* ── POST /user/orgs ────────────────────────────────────────────────────── */

  describe("POST /api/v1/user/orgs", () => {
    it("creates a team organization with the caller as its owner", async () => {
      const created = await createTeam(
        stranger.accessToken,
        "strangers-team",
        "Strangers",
      );

      expect(created).toMatchObject({
        slug: "strangers-team",
        kind: "team",
        role: "owner",
      });

      const mine = await request()
        .get(ORGS)
        .set("Authorization", bearer(stranger.accessToken))
        .expect(200);

      expect(mine.body.data).toHaveLength(2);
    });

    it("refuses a taken slug without saying what holds it", async () => {
      const response = await request()
        .post(ORGS)
        .set("Authorization", bearer(stranger.accessToken))
        .send({ name: "Another Acme", slug: "acme" })
        .expect(409);

      // The slug namespace is global, so this answer is already an oracle for
      // a *name*. It must not become one for a `kind`, and therefore for
      // whether an account exists (`D15.1`'s note to this step).
      expect(response.body.error.code).toBe("CONFLICT");
      expect(JSON.stringify(response.body)).not.toContain("personal");
      expect(JSON.stringify(response.body)).not.toContain("team");
    });

    it("refuses a slug in the reserved personal prefix", async () => {
      const response = await request()
        .post(ORGS)
        .set("Authorization", bearer(stranger.accessToken))
        .send({ name: "Impostor", slug: `personal-${strangerId}` })
        .expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  /* ── PATCH and DELETE ───────────────────────────────────────────────────── */

  describe("PATCH and DELETE /api/v1/user/orgs/:orgId", () => {
    it("lets an owner rename, and refuses a slug edit on a personal organization", async () => {
      const org = await createTeam(owner.accessToken, "renameable");

      await request()
        .patch(`${ORGS}/${org.id}`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ name: "Renamed", slug: "renamed" })
        .expect(200);

      const mine = await request()
        .get(ORGS)
        .set("Authorization", bearer(owner.accessToken))
        .expect(200);

      const personal = (mine.body.data as { id: string; kind: string }[]).find(
        (row) => row.kind === "personal",
      );

      // The name is freely editable — it is what the switcher renders.
      await request()
        .patch(`${ORGS}/${personal?.id ?? ""}`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ name: "My own things" })
        .expect(200);

      // The slug is not: it is derived from the account's id, and that
      // derivation is what proves "exactly one personal organization"
      // (`D15.2`'s review).
      const refused = await request()
        .patch(`${ORGS}/${personal?.id ?? ""}`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ slug: "my-own-things" })
        .expect(409);

      expect(refused.body.error.code).toBe("ORGANIZATION_PERSONAL_UNDELETABLE");
    });

    it("refuses to delete a personal organization", async () => {
      const mine = await request()
        .get(ORGS)
        .set("Authorization", bearer(stranger.accessToken))
        .expect(200);

      const personal = (mine.body.data as { id: string; kind: string }[]).find(
        (row) => row.kind === "personal",
      );

      const response = await request()
        .delete(`${ORGS}/${personal?.id ?? ""}`)
        .set("Authorization", bearer(stranger.accessToken))
        .expect(409);

      expect(response.body.error.code).toBe(
        "ORGANIZATION_PERSONAL_UNDELETABLE",
      );
    });

    it("deletes a team organization, and it leaves the caller's list", async () => {
      const org = await createTeam(stranger.accessToken, "deletable");

      await request()
        .delete(`${ORGS}/${org.id}`)
        .set("Authorization", bearer(stranger.accessToken))
        .expect(204);

      const mine = await request()
        .get(ORGS)
        .set("Authorization", bearer(stranger.accessToken))
        .expect(200);

      expect(
        (mine.body.data as { id: string }[]).some((row) => row.id === org.id),
      ).toBe(false);

      // And the membership no longer resolves, so the guard answers `404` —
      // memberships survive a soft delete and the join is what stops them
      // granting access inside a deleted tenant.
      await request()
        .get(`${ORGS}/${org.id}`)
        .set("Authorization", bearer(stranger.accessToken))
        .expect(404);
    });
  });

  /* ── members, and the last-owner invariant ──────────────────────────────── */

  describe("members", () => {
    it("lists the members of an organization to any member", async () => {
      const org = await createTeam(owner.accessToken, "member-list");
      const member = await freshAccount("listed.member@machxi.local");

      await joinAsMember(org.id, member);

      const response = await request()
        .get(`${ORGS}/${org.id}/members`)
        .set("Authorization", bearer(member.tokens.accessToken))
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(
        (response.body.data as { email: string; role: string }[]).find(
          (row) => row.email === member.email,
        )?.role,
      ).toBe("member");
    });

    it("refuses the last owner's demotion and their removal with 409", async () => {
      const org = await createTeam(owner.accessToken, "last-owner");

      const demote = await request()
        .patch(`${ORGS}/${org.id}/members/${ownerId}`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ role: "admin" })
        .expect(409);

      expect(demote.body.error.code).toBe("ORGANIZATION_LAST_OWNER");

      const leave = await request()
        .delete(`${ORGS}/${org.id}/members/${ownerId}`)
        .set("Authorization", bearer(owner.accessToken))
        .expect(409);

      expect(leave.body.error.code).toBe("ORGANIZATION_LAST_OWNER");
    });

    it("lets the last live owner refuse to leave when the other owner has closed their account", async () => {
      // The case `D15.2` fixed in SQL and had no route to prove through: a
      // closed account keeps its team memberships, so a count of the
      // membership table alone would see an owner nobody can sign in as.
      const org = await createTeam(owner.accessToken, "closed-co-owner");
      const other = await freshAccount("closing.owner@machxi.local");

      await joinAsMember(org.id, other, "admin");

      await request()
        .patch(`${ORGS}/${org.id}/members/${other.id}`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ role: "owner" })
        .expect(204);

      // Two owners, so the first may now leave — proved by *not* doing it.
      await request()
        .delete("/api/v1/user/profile")
        .set("Authorization", bearer(other.tokens.accessToken))
        .send({ currentPassword: NEW_ACCOUNT_PASSWORD })
        .expect(204);

      const leave = await request()
        .delete(`${ORGS}/${org.id}/members/${ownerId}`)
        .set("Authorization", bearer(owner.accessToken))
        .expect(409);

      expect(leave.body.error.code).toBe("ORGANIZATION_LAST_OWNER");
    });

    it("lets a member leave, and refuses them removing somebody else", async () => {
      const org = await createTeam(owner.accessToken, "leaving");
      const member = await freshAccount("leaver@machxi.local");

      await joinAsMember(org.id, member);

      // Removing somebody else needs `owner` or `admin` (ADR-0019 §3's
      // resource rule, which a role guard cannot express).
      const refused = await request()
        .delete(`${ORGS}/${org.id}/members/${ownerId}`)
        .set("Authorization", bearer(member.tokens.accessToken))
        .expect(403);

      expect(refused.body.error.code).toBe("FORBIDDEN");

      // Leaving needs only that it is you.
      await request()
        .delete(`${ORGS}/${org.id}/members/${member.id}`)
        .set("Authorization", bearer(member.tokens.accessToken))
        .expect(204);

      await request()
        .get(`${ORGS}/${org.id}`)
        .set("Authorization", bearer(member.tokens.accessToken))
        .expect(404);
    });
  });

  /* ── invitations (ADR-0067 §2, ADR-0020 §Enumeration) ───────────────────── */

  describe("invitations", () => {
    it("answers the same for an address with an account and one without", async () => {
      const org = await createTeam(owner.accessToken, "enumeration-probe");

      const known = await request()
        .post(`${ORGS}/${org.id}/invitations`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ email: FIXTURE_USERS.disabled, role: "member" })
        .expect(201);

      const unknown = await request()
        .post(`${ORGS}/${org.id}/invitations`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ email: "nobody-at-all@machxi.local", role: "member" })
        .expect(201);

      // Same status, same shape: creating an invitation never looks an account
      // up, so there is nothing for the two responses to differ about.
      expect(Object.keys(known.body.data).sort()).toEqual(
        Object.keys(unknown.body.data).sort(),
      );
      expect(known.body.data.status).toBe(unknown.body.data.status);
    });

    it("mints a token hash no response body carries", async () => {
      const org = await createTeam(owner.accessToken, "token-probe");

      const created = await request()
        .post(`${ORGS}/${org.id}/invitations`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ email: "token.probe@machxi.local", role: "member" })
        .expect(201);

      const [row] = await harness.asOwner((tx) =>
        tx
          .select({ tokenHash: organizationInvitations.tokenHash })
          .from(organizationInvitations)
          .where(eq(organizationInvitations.id, created.body.data.id)),
      );

      // The row carries one…
      expect(row?.tokenHash).toEqual(expect.any(String));
      expect(row?.tokenHash.length).toBeGreaterThan(20);

      // …and nothing on the wire does, on the create or on the list.
      expect(JSON.stringify(created.body)).not.toContain(row?.tokenHash ?? "!");
      expect(JSON.stringify(created.body)).not.toContain("tokenHash");

      const listed = await request()
        .get(`${ORGS}/${org.id}/invitations`)
        .set("Authorization", bearer(owner.accessToken))
        .expect(200);

      expect(JSON.stringify(listed.body)).not.toContain(row?.tokenHash ?? "!");
    });

    it("refuses sorting by the credential digest", async () => {
      const org = await createTeam(owner.accessToken, "sort-probe");

      // `token_hash` is unique, so `indexCoverage` reports it as covered — the
      // allow-list is the only thing keeping it out of `sort=`.
      const response = await request()
        .get(`${ORGS}/${org.id}/invitations?sort=tokenHash`)
        .set("Authorization", bearer(owner.accessToken))
        .expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("runs the lifecycle: create, list by the invitee, accept, member", async () => {
      const org = await createTeam(owner.accessToken, "lifecycle");
      const invitee = await freshAccount("lifecycle.invitee@machxi.local");

      const created = await request()
        .post(`${ORGS}/${org.id}/invitations`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ email: invitee.email, role: "admin" })
        .expect(201);

      expect(created.body.data).toMatchObject({
        email: invitee.email,
        role: "admin",
        status: "pending",
        organizationName: "A Team",
      });

      const pending = await request()
        .get(INVITATIONS)
        .set("Authorization", bearer(invitee.tokens.accessToken))
        .expect(200);

      expect(pending.body.data).toHaveLength(1);
      expect(pending.body.data[0].id).toBe(created.body.data.id);

      const accepted = await request()
        .post(`${INVITATIONS}/${created.body.data.id}/accept`)
        .set("Authorization", bearer(invitee.tokens.accessToken))
        .expect(200);

      // `200` with the organization joined, so the switcher needs no second
      // request.
      expect(accepted.body.data).toMatchObject({ id: org.id, role: "admin" });

      // Single use: the second accept finds nothing pending.
      const again = await request()
        .post(`${INVITATIONS}/${created.body.data.id}/accept`)
        .set("Authorization", bearer(invitee.tokens.accessToken))
        .expect(409);

      expect(again.body.error.code).toBe("CONFLICT");

      // And it is gone from both lists.
      await request()
        .get(INVITATIONS)
        .set("Authorization", bearer(invitee.tokens.accessToken))
        .expect(200)
        .expect((res) => {
          expect(res.body.data).toHaveLength(0);
        });
    });

    it("declines an invitation, which joins nothing", async () => {
      const org = await createTeam(owner.accessToken, "declining");
      const invitee = await freshAccount("decliner@machxi.local");

      const created = await request()
        .post(`${ORGS}/${org.id}/invitations`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ email: invitee.email, role: "member" })
        .expect(201);

      await request()
        .post(`${INVITATIONS}/${created.body.data.id}/decline`)
        .set("Authorization", bearer(invitee.tokens.accessToken))
        .expect(204);

      await request()
        .get(`${ORGS}/${org.id}`)
        .set("Authorization", bearer(invitee.tokens.accessToken))
        .expect(404);
    });

    it("revokes an invitation, and the invitee stops seeing it", async () => {
      const org = await createTeam(owner.accessToken, "revoking");
      const invitee = await freshAccount("revoked.invitee@machxi.local");

      const created = await request()
        .post(`${ORGS}/${org.id}/invitations`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ email: invitee.email, role: "member" })
        .expect(201);

      await request()
        .delete(`${ORGS}/${org.id}/invitations/${created.body.data.id}`)
        .set("Authorization", bearer(owner.accessToken))
        .expect(204);

      const pending = await request()
        .get(INVITATIONS)
        .set("Authorization", bearer(invitee.tokens.accessToken))
        .expect(200);

      expect(pending.body.data).toHaveLength(0);

      const accept = await request()
        .post(`${INVITATIONS}/${created.body.data.id}/accept`)
        .set("Authorization", bearer(invitee.tokens.accessToken))
        .expect(409);

      expect(accept.body.error.code).toBe("CONFLICT");
    });

    it("refuses an expired invitation", async () => {
      const org = await createTeam(owner.accessToken, "expiring");
      const invitee = await freshAccount("expired.invitee@machxi.local");

      const created = await request()
        .post(`${ORGS}/${org.id}/invitations`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ email: invitee.email, role: "member" })
        .expect(201);

      // `expired` is a state no column holds and no sweeper writes: it becomes
      // true as the clock passes `expires_at`, so this moves the clock rather
      // than a status.
      await harness.asOwner((tx) =>
        tx
          .update(organizationInvitations)
          .set({ expiresAt: new Date(Date.now() - 1000) })
          .where(eq(organizationInvitations.id, created.body.data.id)),
      );

      const pending = await request()
        .get(INVITATIONS)
        .set("Authorization", bearer(invitee.tokens.accessToken))
        .expect(200);

      expect(pending.body.data).toHaveLength(0);

      const accept = await request()
        .post(`${INVITATIONS}/${created.body.data.id}/accept`)
        .set("Authorization", bearer(invitee.tokens.accessToken))
        .expect(409);

      expect(accept.body.error.code).toBe("CONFLICT");
    });

    it("refuses inviting an address that is already a member", async () => {
      const org = await createTeam(owner.accessToken, "already-in");
      const member = await freshAccount("already.in@machxi.local");

      await joinAsMember(org.id, member);

      const response = await request()
        .post(`${ORGS}/${org.id}/invitations`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ email: member.email, role: "member" })
        .expect(409);

      // The one distinguishable refusal, and it tells the inviter only what
      // the members list they can already read would (ADR-0067 §2).
      expect(response.body.error.code).toBe("CONFLICT");
    });

    it("refuses inviting anybody into a personal organization", async () => {
      // The caller holds `owner` on their own personal organization, so the
      // route's guard admits them: this refusal is the only thing standing
      // between a second member and every fact ADR-0067 §2 rests on — the
      // derived slug that no third party may see, the `created_by` key that
      // proves idempotence, and the delete that goes with the account.
      const mine = await request()
        .get(ORGS)
        .set("Authorization", bearer(owner.accessToken))
        .expect(200);

      const personal = (mine.body.data as { id: string; kind: string }[]).find(
        (row) => row.kind === "personal",
      );

      const response = await request()
        .post(`${ORGS}/${personal?.id ?? ""}/invitations`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ email: "into.personal@machxi.local", role: "member" })
        .expect(409);

      expect(response.body.error.code).toBe("ORGANIZATION_PERSONAL_CLOSED");
    });

    it("refuses a second pending invitation to the same address", async () => {
      // An invitation has no natural key, so nothing in the schema bounds
      // this. Unbounded, it lands on somebody else: the invitee's own list is
      // unpaged, and the day the mail deliverable fills the marked call the
      // same loop is a mail bomb at an address the inviter never controlled.
      const org = await createTeam(owner.accessToken, "double-invite");
      const email = "invited.twice@machxi.local";

      await request()
        .post(`${ORGS}/${org.id}/invitations`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ email, role: "member" })
        .expect(201);

      const second = await request()
        .post(`${ORGS}/${org.id}/invitations`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ email, role: "member" })
        .expect(409);

      expect(second.body.error.code).toBe("ORGANIZATION_INVITATION_PENDING");

      // Revoking the first frees the address again: the refusal is about the
      // outstanding offer, not about the address.
      const pending = await request()
        .get(`${ORGS}/${org.id}/invitations`)
        .set("Authorization", bearer(owner.accessToken))
        .expect(200);

      await request()
        .delete(
          `${ORGS}/${org.id}/invitations/${(pending.body.data as { id: string }[])[0]?.id ?? ""}`,
        )
        .set("Authorization", bearer(owner.accessToken))
        .expect(204);

      await request()
        .post(`${ORGS}/${org.id}/invitations`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ email, role: "member" })
        .expect(201);
    });

    it("lets an account that closed and came back be invited again", async () => {
      // A closed account keeps its team memberships while
      // `users_email_active_unique` releases its address, so a membership row
      // for a dead account would match by email forever and answer "already a
      // member" about somebody who is not one.
      const org = await createTeam(owner.accessToken, "returning-member");
      const email = "comes.back@machxi.local";
      const first = await freshAccount(email);

      await joinAsMember(org.id, first);

      await request()
        .delete("/api/v1/user/profile")
        .set("Authorization", bearer(first.tokens.accessToken))
        .send({ currentPassword: NEW_ACCOUNT_PASSWORD })
        .expect(204);

      // The same address registers again — a different account, same email.
      const second = await freshAccount(email);

      await request()
        .post(`${ORGS}/${org.id}/invitations`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ email, role: "member" })
        .expect(201);

      const pending = await request()
        .get(INVITATIONS)
        .set("Authorization", bearer(second.tokens.accessToken))
        .expect(200);

      expect(pending.body.data).toHaveLength(1);
    });

    it("refuses inviting an owner, which is not an invitable role", async () => {
      const org = await createTeam(owner.accessToken, "owner-invite");

      const response = await request()
        .post(`${ORGS}/${org.id}/invitations`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ email: "would.be.owner@machxi.local", role: "owner" })
        .expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("does not let one invitee act on another's invitation", async () => {
      const org = await createTeam(owner.accessToken, "wrong-invitee");
      const invitee = await freshAccount("rightful@machxi.local");
      const interloper = await freshAccount("interloper@machxi.local");

      const created = await request()
        .post(`${ORGS}/${org.id}/invitations`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ email: invitee.email, role: "member" })
        .expect(201);

      // Scoped by the caller's own address, read from their account and never
      // from the request: there is nothing here to name but your own.
      const refused = await request()
        .post(`${INVITATIONS}/${created.body.data.id}/accept`)
        .set("Authorization", bearer(interloper.tokens.accessToken))
        .expect(404);

      expect(refused.body.error.code).toBe("NOT_FOUND");
    });

    /*
     * The link (ADR-0071 §5) — the send, the lookup, and acceptance bound to
     * the invited address.
     *
     * What this closes is the exposure ADR-0067 §Consequences accepted and
     * `D15.1` escalated: an invitation used to be claimed by address match
     * alone, and nothing verified an address. Both halves are real now — §3
     * makes every `active` account's address proven, and these cases prove the
     * second, that the link itself has to be presented.
     */
    describe("the mailed link", () => {
      const LOOKUP = "/api/v1/public/invitations/lookup";
      const ACCEPT_BY_TOKEN = `${INVITATIONS}/accept-by-token`;

      /** Creates an invitation and reads the token out of the message sent. */
      const invite = async (
        organizationId: string,
        email: string,
        role: "admin" | "member" = "member",
      ) => {
        const created = await request()
          .post(`${ORGS}/${organizationId}/invitations`)
          .set("Authorization", bearer(owner.accessToken))
          .send({ email, role })
          .expect(201);

        return {
          id: created.body.data.id as string,
          token: tokenFromMail(lastMailTo(harness, email)),
        };
      };

      it("sends the invitation to the invited address with the token in the fragment", async () => {
        const org = await createTeam(owner.accessToken, "delivered", "Deliver");
        const email = "delivered.invitee@machxi.local";

        const created = await request()
          .post(`${ORGS}/${org.id}/invitations`)
          .set("Authorization", bearer(owner.accessToken))
          .send({ email, role: "member" })
          .expect(201);

        const message = lastMailTo(harness, email);

        expect(message?.subject).toContain("Deliver");
        // The fragment is the whole design (ADR-0057 §2 as ADR-0071 §1
        // inherits it): a token in a path or a query would reach every access
        // log and proxy between the reader and the API. `tokenFromMail` reads
        // only after a `#`, so it throws if that ever changes.
        const token = tokenFromMail(message);

        expect(message?.text).toContain(`#token=${token}`);
        expect(message?.text.split("#token=")[0]).not.toContain(token);

        // And the database still holds only the hash, which nothing returns.
        const [row] = await harness.asOwner((tx) =>
          tx
            .select({ tokenHash: organizationInvitations.tokenHash })
            .from(organizationInvitations)
            .where(eq(organizationInvitations.id, created.body.data.id)),
        );

        expect(row?.tokenHash).not.toBe(token);
        expect(JSON.stringify(created.body)).not.toContain(token);
      });

      it("answers the lookup with the organization, the address and the role", async () => {
        const org = await createTeam(owner.accessToken, "lookup-ok", "Lookup");
        const { token } = await invite(
          org.id,
          "lookup.invitee@machxi.local",
          "admin",
        );

        // Unauthenticated: whoever opened the mail can read the offer.
        const response = await request()
          .post(LOOKUP)
          .send({ token })
          .expect(200);

        expect(response.body.data).toEqual({
          organizationName: "Lookup",
          email: "lookup.invitee@machxi.local",
          role: "admin",
        });
        // No id, deliberately: that would be authority for the accept path
        // scoped by address alone, which holding the token does not carry.
        expect(response.body.data.id).toBeUndefined();
      });

      it("answers one 404 for unknown, declined, revoked and expired alike", async () => {
        const org = await createTeam(owner.accessToken, "lookup-404");
        const lookup = (token: string) =>
          request().post(LOOKUP).send({ token });

        const unknown = await lookup("A".repeat(43)).expect(404);

        expect(unknown.body.error.code).toBe("NOT_FOUND");

        const declined = await invite(org.id, "declines.link@machxi.local");
        const decliner = await freshAccount("declines.link@machxi.local");

        await request()
          .post(`${INVITATIONS}/${declined.id}/decline`)
          .set("Authorization", bearer(decliner.tokens.accessToken))
          .expect(204);

        await lookup(declined.token).expect(404);

        const revoked = await invite(org.id, "revokes.link@machxi.local");

        await request()
          .delete(`${ORGS}/${org.id}/invitations/${revoked.id}`)
          .set("Authorization", bearer(owner.accessToken))
          .expect(204);

        await lookup(revoked.token).expect(404);

        const expired = await invite(org.id, "expires.link@machxi.local");

        await harness.asOwner((tx) =>
          tx
            .update(organizationInvitations)
            .set({ expiresAt: new Date(Date.now() - 1000) })
            .where(eq(organizationInvitations.id, expired.id)),
        );

        await lookup(expired.token).expect(404);
      });

      it("joins the caller whose address is the invited one", async () => {
        const org = await createTeam(owner.accessToken, "join-by-link");
        const invitee = await freshAccount("joins.by.link@machxi.local");
        const { token } = await invite(org.id, invitee.email, "admin");

        const joined = await request()
          .post(ACCEPT_BY_TOKEN)
          .set("Authorization", bearer(invitee.tokens.accessToken))
          .send({ token })
          .expect(200);

        expect(joined.body.data).toMatchObject({ id: org.id, role: "admin" });

        // Single use, through the same guarded statement `/:id/accept` takes.
        const again = await request()
          .post(ACCEPT_BY_TOKEN)
          .set("Authorization", bearer(invitee.tokens.accessToken))
          .send({ token })
          .expect(404);

        expect(again.body.error.code).toBe("NOT_FOUND");

        // The row is accepted, so the lookup stops answering for it too.
        await request().post(LOOKUP).send({ token }).expect(404);
      });

      it("refuses a caller whose address is not the invited one, and spends nothing", async () => {
        const org = await createTeam(owner.accessToken, "wrong-address");
        const invitee = await freshAccount("rightful.link@machxi.local");
        const bystander = await freshAccount("bystander.link@machxi.local");
        const { token } = await invite(org.id, invitee.email);

        const refused = await request()
          .post(ACCEPT_BY_TOKEN)
          .set("Authorization", bearer(bystander.tokens.accessToken))
          .send({ token })
          .expect(403);

        // Distinguishable on purpose: the screen can say "sign in with the
        // address this was sent to" rather than "this link is not valid".
        expect(refused.body.error.code).toBe(
          "ORGANIZATION_INVITATION_ADDRESS_MISMATCH",
        );

        // A refused acceptance spends nothing (ADR-0071 §1): the link the
        // invitee was actually sent still works, from the right account.
        await request()
          .post(ACCEPT_BY_TOKEN)
          .set("Authorization", bearer(invitee.tokens.accessToken))
          .send({ token })
          .expect(200);

        // …and the bystander joined nothing.
        await request()
          .get(`${ORGS}/${org.id}`)
          .set("Authorization", bearer(bystander.tokens.accessToken))
          .expect(404);
      });

      it("requires a session: the token alone joins nobody", async () => {
        const org = await createTeam(owner.accessToken, "needs-session");
        const { token } = await invite(org.id, "anonymous.link@machxi.local");

        // The lookup is public and the accept is not: reading the offer is
        // what holding the link buys, and joining needs an account to join.
        await request().post(LOOKUP).send({ token }).expect(200);
        await request().post(ACCEPT_BY_TOKEN).send({ token }).expect(401);
      });
    });

    it("refuses a member listing or creating invitations", async () => {
      const org = await createTeam(owner.accessToken, "invite-guard");
      const member = await freshAccount("cannot.invite@machxi.local");

      await joinAsMember(org.id, member);

      await request()
        .get(`${ORGS}/${org.id}/invitations`)
        .set("Authorization", bearer(member.tokens.accessToken))
        .expect(403);

      await request()
        .post(`${ORGS}/${org.id}/invitations`)
        .set("Authorization", bearer(member.tokens.accessToken))
        .send({ email: "nope@machxi.local", role: "member" })
        .expect(403);
    });
  });

  /* ── row-level security (ADR-0067 §5, ADR-0078 §4 as amended at D29.4) ── */

  describe("row-level security under the repositories", () => {
    /**
     * A request context as the guards leave it: `authenticate` places the
     * principal and `requireMembership` the organization. The transaction
     * opened inside it is the composition root's own `open`, so what these
     * cases see is what every service's transaction sees.
     */
    const inRequest = <T>(
      scope: {
        readonly principal: RequestContext["principal"];
        readonly organizationId?: string;
        /** What `placeRouteOrganization` leaves on a staff request (ADR-0083 §2). */
        readonly routeOrganizationId?: string;
      },
      fn: (tx: DbExecutor) => Promise<T>,
    ): Promise<T> => {
      const ctx = createRequestContext({
        requestId: "rls-case",
        logger: harness.logger,
      });

      ctx.principal = scope.principal;
      ctx.organization =
        scope.organizationId === undefined
          ? null
          : { id: scope.organizationId, slug: "acme", role: "owner" };
      ctx.routeOrganizationId = scope.routeOrganizationId ?? null;

      return runWithContext(ctx, () => openInRequestScope(harness.db.db)(fn));
    };

    const userPrincipal = (id: string): RequestContext["principal"] => ({
      kind: "user",
      id,
      roles: ["customer"],
      sessionId: "rls-case",
    });

    /** Every membership row, with nothing in its `where` — the forgotten scope. */
    const everyMembership = (tx: DbExecutor) =>
      tx
        .select({
          organizationId: organizationMemberships.organizationId,
          userId: organizationMemberships.userId,
        })
        .from(organizationMemberships);

    it("a query that forgets its organization returns nothing", async () => {
      // The rows are there: the seeders and this file's cases wrote several
      // tenants' worth, and the owner's connection reads them all.
      const all = await harness.asOwner(everyMembership);

      expect(all.length).toBeGreaterThan(1);
      expect(
        new Set(all.map((row) => row.organizationId)).size,
      ).toBeGreaterThan(1);

      // On the application role with no setting placed — any statement that
      // did not go through a scoped transaction — the table reads empty.
      expect(await everyMembership(harness.db.db)).toEqual([]);

      // And inside a transaction opened with no request at all, the same.
      expect(await inRequest({ principal: null }, everyMembership)).toEqual([]);
    });

    it("shows a member's request its organization alone — not even the caller's own rows elsewhere", async () => {
      // The caller has memberships elsewhere: their personal organization and
      // the teams this file created.
      const theirs = await harness.asOwner((tx) =>
        everyMembership(tx).where(eq(organizationMemberships.userId, ownerId)),
      );

      expect(theirs.some((row) => row.organizationId !== orgId)).toBe(true);

      const seen = await inRequest(
        { principal: userPrincipal(ownerId), organizationId: orgId },
        everyMembership,
      );

      // D29.7: once the organization is placed the principal is not, so a
      // forgotten scope reads that organization's rows and nothing else — the
      // caller's own memberships elsewhere included.
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((row) => row.organizationId === orgId)).toBe(true);
    });

    it("refuses a write into an organization the transaction is not scoped to", async () => {
      const team = await createTeam(stranger.accessToken, "rls-elsewhere");

      // The owner's request, scoped to acme, tries to put itself into the
      // stranger's team: the insert names a row no placed setting admits.
      const refused = await inRequest(
        { principal: userPrincipal(strangerId), organizationId: orgId },
        (tx) =>
          tx.insert(organizationMemberships).values({
            organizationId: team.id,
            userId: ownerId,
            role: "owner",
          }),
      ).catch((caught: unknown) => caught);

      expect((refused as { cause?: { code?: string } }).cause?.code).toBe(
        "42501",
      );
    });

    it("a session-level scope does not reach a request transaction", async () => {
      // D29.7: a connection whose session already carries a tenant setting —
      // a `set_config(…, false)` somebody ran on a pooled connection — and a
      // user's request opened on it. The opener writes `''` for each setting
      // it does not place, so the session's organization is shadowed for the
      // transaction and the request sees what its own scope admits. (Until
      // `D35.2` this case used the `system` widening as its session value;
      // no setting widens anything now, ADR-0083 §1.)
      const team = await createTeam(stranger.accessToken, "rls-session");
      const pinned = createDb(harness.config.db.url, {
        max: 1,
        idleTimeout: 1,
      });

      try {
        await pinned.db.execute(
          sql`select set_config('app.organization_id', ${orgId}, false)`,
        );

        // The setting is really on the session: a bare statement sees acme's
        // rows.
        const bare = await everyMembership(pinned.db);

        expect(bare.length).toBeGreaterThan(0);
        expect(bare.every((row) => row.organizationId === orgId)).toBe(true);

        const seen = await runWithContext(
          Object.assign(
            createRequestContext({
              requestId: "rls-session",
              logger: harness.logger,
            }),
            {
              principal: userPrincipal(strangerId),
              organization: { id: team.id, slug: "x", role: "owner" as const },
            },
          ),
          () => openInRequestScope(pinned.db)(everyMembership),
        );

        expect(seen.length).toBeGreaterThan(0);
        expect(seen.every((row) => row.organizationId === team.id)).toBe(true);

        // And a request with no principal at all sees nothing.
        expect(await openInRequestScope(pinned.db)(everyMembership)).toEqual(
          [],
        );
      } finally {
        await pinned.close();
      }
    });

    it("an invitee cannot rewrite an invitation's organization or role", async () => {
      // D29.7, migration `0020`: the consume policies admit the invitee's
      // UPDATE by the row, and the column grant is what keeps that UPDATE to
      // the stamps. Without it, a transaction that can see the invitation by
      // its address could move it to another organization or raise its role
      // while keeping the `email` it was admitted by.
      const org = await createTeam(owner.accessToken, "rls-column-grant");
      const elsewhere = await createTeam(stranger.accessToken, "rls-target");
      const invitee = await freshAccount("rls.invitee@machxi.local");

      const created = await request()
        .post(`${ORGS}/${org.id}/invitations`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ email: invitee.email, role: "member" })
        .expect(201);
      const id = created.body.data.id as string;

      const asInvitee = <T>(fn: (tx: DbExecutor) => Promise<T>) =>
        inRequest({ principal: userPrincipal(invitee.id) }, fn).catch(
          (caught: unknown) =>
            (caught as { cause?: { code?: string } }).cause?.code,
        );

      expect(
        await asInvitee((tx) =>
          tx
            .update(organizationInvitations)
            .set({ role: "admin" })
            .where(eq(organizationInvitations.id, id)),
        ),
      ).toBe("42501");
      expect(
        await asInvitee((tx) =>
          tx
            .update(organizationInvitations)
            .set({ organizationId: elsewhere.id })
            .where(eq(organizationInvitations.id, id)),
        ),
      ).toBe("42501");

      const [row] = await harness.asOwner((tx) =>
        tx
          .select({
            organizationId: organizationInvitations.organizationId,
            role: organizationInvitations.role,
          })
          .from(organizationInvitations)
          .where(eq(organizationInvitations.id, id)),
      );

      expect(row).toEqual({ organizationId: org.id, role: "member" });

      // The stamp the invitee's own path writes is still theirs to write.
      await request()
        .post(`${INVITATIONS}/${id}/decline`)
        .set("Authorization", bearer(invitee.tokens.accessToken))
        .expect(204);
    });

    /** The SQLSTATE a refused statement carried, or `"ok"` when it ran. */
    const outcome = (work: Promise<unknown>): Promise<string | undefined> =>
      work.then(
        () => "ok",
        (caught: unknown) =>
          (caught as { cause?: { code?: string } }).cause?.code,
      );

    it("an invitee cannot revoke an invitation addressed to them", async () => {
      // ADR-0083 §3: the invitee's consume policy checks the row it leaves.
      // The invitee accepts or declines; revoking is the organization's act,
      // through the tenant policy, and the column grant alone would admit
      // `revoked_at` to anybody the policy lets update the row.
      const org = await createTeam(owner.accessToken, "rls-invitee-revoke");
      const invitee = await freshAccount("rls.revoker@machxi.local");

      const created = await request()
        .post(`${ORGS}/${org.id}/invitations`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ email: invitee.email, role: "member" })
        .expect(201);
      const id = created.body.data.id as string;

      const asInvitee = (stamp: "declinedAt" | "revokedAt") =>
        inRequest({ principal: userPrincipal(invitee.id) }, async (tx) => {
          const stamped = await tx
            .update(organizationInvitations)
            .set({ [stamp]: new Date(), updatedAt: new Date() })
            .where(eq(organizationInvitations.id, id))
            .returning({ id: organizationInvitations.id });

          // Rolled back whatever happened, so the row stays as it was.
          throw Object.assign(new Error("rolled back"), {
            cause: { code: `stamped:${String(stamped.length)}` },
          });
        });

      expect(await outcome(asInvitee("revokedAt"))).toBe("42501");
      // The control (`D35.2`'s review, fixed at `D35.3`): the same
      // transaction, as the same invitee, may decline — so the refusal above
      // is the check's and not the scope's.
      expect(await outcome(asInvitee("declinedAt"))).toBe("stamped:1");

      const [row] = await harness.asOwner((tx) =>
        tx
          .select({
            revokedAt: organizationInvitations.revokedAt,
            declinedAt: organizationInvitations.declinedAt,
          })
          .from(organizationInvitations)
          .where(eq(organizationInvitations.id, id)),
      );

      expect(row).toEqual({ revokedAt: null, declinedAt: null });

      // The stamps the invitee's own paths write are still theirs to write.
      await request()
        .post(`${INVITATIONS}/${id}/decline`)
        .set("Authorization", bearer(invitee.tokens.accessToken))
        .expect(204);
    });

    it("a bearer cannot decline or revoke by token", async () => {
      // ADR-0083 §3: the bearer's consume policy admits an accept and
      // nothing else. The transaction holds the token's hash and no
      // principal — exactly what the lookup and the accept-by-token place.
      const org = await createTeam(owner.accessToken, "rls-bearer");
      const email = "rls.bearer@machxi.local";

      const created = await request()
        .post(`${ORGS}/${org.id}/invitations`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ email, role: "member" })
        .expect(201);
      const id = created.body.data.id as string;
      const [held] = await harness.asOwner((tx) =>
        tx
          .select({ tokenHash: organizationInvitations.tokenHash })
          .from(organizationInvitations)
          .where(eq(organizationInvitations.id, id)),
      );
      const tokenHash = held!.tokenHash;

      const asBearer = (stamp: "acceptedAt" | "declinedAt" | "revokedAt") =>
        inRequest({ principal: null }, async (tx) => {
          await setTenantScope(tx, { invitationTokenHash: tokenHash });

          const stamped = await tx
            .update(organizationInvitations)
            .set({ [stamp]: new Date(), updatedAt: new Date() })
            .where(eq(organizationInvitations.id, id))
            .returning({ id: organizationInvitations.id });

          // Rolled back whatever happened, so the accept below leaves the
          // row as the refusals found it.
          throw Object.assign(new Error("rolled back"), {
            cause: { code: `stamped:${String(stamped.length)}` },
          });
        });

      expect(await outcome(asBearer("declinedAt"))).toBe("42501");
      expect(await outcome(asBearer("revokedAt"))).toBe("42501");
      // The control: the same transaction may accept, so the refusals above
      // are the check's and not the scope's.
      expect(await outcome(asBearer("acceptedAt"))).toBe("stamped:1");

      const [row] = await harness.asOwner((tx) =>
        tx
          .select({
            acceptedAt: organizationInvitations.acceptedAt,
            declinedAt: organizationInvitations.declinedAt,
            revokedAt: organizationInvitations.revokedAt,
          })
          .from(organizationInvitations)
          .where(eq(organizationInvitations.id, id)),
      );

      expect(row).toEqual({
        acceptedAt: null,
        declinedAt: null,
        revokedAt: null,
      });
    });

    it("a bearer cannot un-revoke an invitation", async () => {
      // ADR-0083 §3 as amended at `D35.3`: the consume policies admit only an
      // unended invitation. The column grant admits all three stamps, and the
      // bearer's check forbids only the stamps it never writes — so without
      // "unended" in the `USING`, clearing `revoked_at` while stamping
      // `accepted_at` would pass both, and a revoked invitation would be
      // accepted.
      const org = await createTeam(owner.accessToken, "rls-bearer-unrevoke");

      const created = await request()
        .post(`${ORGS}/${org.id}/invitations`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ email: "rls.unrevoke@machxi.local", role: "member" })
        .expect(201);
      const id = created.body.data.id as string;
      const [held] = await harness.asOwner((tx) =>
        tx
          .select({ tokenHash: organizationInvitations.tokenHash })
          .from(organizationInvitations)
          .where(eq(organizationInvitations.id, id)),
      );
      const tokenHash = held!.tokenHash;

      await request()
        .delete(`${ORGS}/${org.id}/invitations/${id}`)
        .set("Authorization", bearer(owner.accessToken))
        .expect(204);

      const unrevoked = await inRequest({ principal: null }, async (tx) => {
        await setTenantScope(tx, { invitationTokenHash: tokenHash });

        // Still readable by its hash: the select policy is unchanged, so what
        // the update below misses it is the consume policy's `USING`.
        const [readable] = await tx
          .select({ id: organizationInvitations.id })
          .from(organizationInvitations)
          .where(eq(organizationInvitations.id, id));

        expect(readable?.id).toBe(id);

        return tx
          .update(organizationInvitations)
          .set({
            revokedAt: null,
            acceptedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(organizationInvitations.id, id))
          .returning({ id: organizationInvitations.id });
      });

      expect(unrevoked).toEqual([]);

      const [row] = await harness.asOwner((tx) =>
        tx
          .select({
            acceptedAt: organizationInvitations.acceptedAt,
            revokedAt: organizationInvitations.revokedAt,
          })
          .from(organizationInvitations)
          .where(eq(organizationInvitations.id, id)),
      );

      expect(row?.acceptedAt).toBeNull();
      expect(row?.revokedAt).toBeInstanceOf(Date);
    });

    it("an invitee cannot un-revoke an invitation addressed to them", async () => {
      // The invitee's equivalent: clearing the organization's `revoked_at`
      // while stamping a decline or an accept touches no row, and neither
      // does stamping an accept on an invitation the invitee declined.
      const org = await createTeam(owner.accessToken, "rls-invitee-unrevoke");
      const invitee = await freshAccount("rls.unrevoker@machxi.local");

      const invite = async () => {
        const created = await request()
          .post(`${ORGS}/${org.id}/invitations`)
          .set("Authorization", bearer(owner.accessToken))
          .send({ email: invitee.email, role: "member" })
          .expect(201);

        return created.body.data.id as string;
      };

      const revoked = await invite();

      await request()
        .delete(`${ORGS}/${org.id}/invitations/${revoked}`)
        .set("Authorization", bearer(owner.accessToken))
        .expect(204);

      const declined = await invite();

      await request()
        .post(`${INVITATIONS}/${declined}/decline`)
        .set("Authorization", bearer(invitee.tokens.accessToken))
        .expect(204);

      const asInvitee = (
        id: string,
        set: Partial<typeof organizationInvitations.$inferInsert>,
      ) =>
        inRequest({ principal: userPrincipal(invitee.id) }, (tx) =>
          tx
            .update(organizationInvitations)
            .set({ ...set, updatedAt: new Date() })
            .where(eq(organizationInvitations.id, id))
            .returning({ id: organizationInvitations.id }),
        );

      expect(
        await asInvitee(revoked, { revokedAt: null, declinedAt: new Date() }),
      ).toEqual([]);
      expect(
        await asInvitee(revoked, { revokedAt: null, acceptedAt: new Date() }),
      ).toEqual([]);
      expect(
        await asInvitee(declined, { declinedAt: null, acceptedAt: new Date() }),
      ).toEqual([]);

      const rows = await harness.asOwner((tx) =>
        tx
          .select({
            id: organizationInvitations.id,
            acceptedAt: organizationInvitations.acceptedAt,
            declinedAt: organizationInvitations.declinedAt,
            revokedAt: organizationInvitations.revokedAt,
          })
          .from(organizationInvitations)
          .where(eq(organizationInvitations.organizationId, org.id)),
      );
      const byId = new Map(rows.map((row) => [row.id, row]));

      expect(byId.get(revoked)?.revokedAt).toBeInstanceOf(Date);
      expect(byId.get(revoked)?.acceptedAt).toBeNull();
      expect(byId.get(revoked)?.declinedAt).toBeNull();
      expect(byId.get(declined)?.declinedAt).toBeInstanceOf(Date);
      expect(byId.get(declined)?.acceptedAt).toBeNull();
    });

    const staffPrincipal: RequestContext["principal"] = {
      kind: "staff",
      id: "00000000-0000-4000-8000-000000000067",
      roles: ["super_admin"],
      sessionId: "rls-case",
    };

    /** Every invitation row, with nothing in its `where`. */
    const everyInvitation = (tx: DbExecutor) =>
      tx
        .select({ organizationId: organizationInvitations.organizationId })
        .from(organizationInvitations);

    it("a staff read of one organization's members sees no other organization's", async () => {
      // ADR-0083 §2: no widening. The staff request under
      // `/admin/organizations/:id` is scoped to that organization alone, so a
      // query that forgot its predicate reads that organization's rows and no
      // other tenant's.
      const seen = await inRequest(
        { principal: staffPrincipal, routeOrganizationId: orgId },
        everyMembership,
      );

      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((row) => row.organizationId === orgId)).toBe(true);
      expect(seen).toHaveLength(
        (
          await harness.asOwner((tx) =>
            everyMembership(tx).where(
              eq(organizationMemberships.organizationId, orgId),
            ),
          )
        ).length,
      );

      // And on the wire: the guard on `/:id` is what places the scope, so the
      // members list answers rows — with no widening, an unplaced scope would
      // answer an empty page.
      const staff = await login(harness.app, "staff", superAdmin());
      const listed = await request()
        .get(`/api/v1/admin/organizations/${orgId}/memberships`)
        .set("Authorization", bearer(staff.accessToken))
        .expect(200);
      const rows = listed.body.data as { organizationId: string }[];

      expect(rows.length).toBe(seen.length);
      expect(rows.every((row) => row.organizationId === orgId)).toBe(true);
    });

    it("a staff request that names no organization reads no membership", async () => {
      // Tenants' rows are there for the owner to see…
      expect((await harness.asOwner(everyMembership)).length).toBeGreaterThan(
        1,
      );

      // …and a staff request with no organization route places nothing: not
      // a widening, and not its own id as a user's.
      expect(
        await inRequest({ principal: staffPrincipal }, everyMembership),
      ).toEqual([]);
      expect(
        await inRequest({ principal: staffPrincipal }, everyInvitation),
      ).toEqual([]);
    });

    it("staff create an organization with its owner", async () => {
      // `POST /admin/organizations` is not under `/:id`, so nothing is placed
      // for it; the service enters the organization it has just created
      // before writing the owner's membership (ADR-0083 §2).
      const staff = await login(harness.app, "staff", superAdmin());
      const created = await request()
        .post("/api/v1/admin/organizations")
        .set("Authorization", bearer(staff.accessToken))
        .send({
          name: "Staff Made",
          slug: "rls-staff-made",
          ownerId: strangerId,
        })
        .expect(201);
      const id = created.body.data.id as string;

      expect(
        await harness.asOwner((tx) =>
          tx
            .select({
              userId: organizationMemberships.userId,
              role: organizationMemberships.role,
            })
            .from(organizationMemberships)
            .where(eq(organizationMemberships.organizationId, id)),
        ),
      ).toEqual([{ userId: strangerId, role: "owner" }]);

      // The owner sees it among their own.
      const mine = await request()
        .get(ORGS)
        .set("Authorization", bearer(stranger.accessToken))
        .expect(200);

      expect(
        (mine.body.data as { id: string; role: string }[]).find(
          (row) => row.id === id,
        )?.role,
      ).toBe("owner");
    });

    it("a staff deletion of a user removes their memberships by cascade", async () => {
      // ADR-0083 §2: referential actions are not subject to row-level
      // security, so a cascade needs no setting. No staff route hard-deletes
      // a user today (ADR-0028 keeps accounts), so the property is held at
      // the database: the application role, in a staff request's transaction
      // that places nothing, deletes an account holding memberships in two
      // organizations, and both go with it.
      const second = await createTeam(stranger.accessToken, "rls-cascade");
      const [account] = await harness.asOwner((tx) =>
        tx
          .insert(users)
          .values({ email: "rls.cascade@machxi.local", status: "disabled" })
          .returning({ id: users.id }),
      );
      const accountId = account!.id;

      await harness.asOwner((tx) =>
        tx.insert(organizationMemberships).values([
          { organizationId: orgId, userId: accountId, role: "member" },
          { organizationId: second.id, userId: accountId, role: "member" },
        ]),
      );

      const deleted = await inRequest({ principal: staffPrincipal }, (tx) =>
        tx
          .delete(users)
          .where(eq(users.id, accountId))
          .returning({ id: users.id }),
      );

      expect(deleted).toEqual([{ id: accountId }]);
      expect(
        await harness.asOwner((tx) =>
          everyMembership(tx).where(
            eq(organizationMemberships.userId, accountId),
          ),
        ),
      ).toEqual([]);
    });

    it("two concurrent requests in different organizations each see only their own", async () => {
      // ADR-0083 §6: the opener reads the scope from request storage, and no
      // request's continuation runs inside another's. Two requests of the two
      // kinds that place an organization — a member's, placed by
      // `requireMembership`, and a staff request's, placed by
      // `placeRouteOrganization` — meet at two barriers.
      //
      // **The first barrier is the one that proves isolation.** Each request
      // resumes from it on a promise the *other* settled, and only then opens
      // its transaction, so the scope the opener reads from storage is read
      // in a continuation the other request released: a store that leaked
      // across continuations would hand one of them the other's scope here.
      // The second, inside the transactions, proves only that both are in
      // flight at once.
      const team = await createTeam(stranger.accessToken, "rls-concurrent");

      const barrier = () => {
        let arrived = 0;
        let release: () => void = () => undefined;
        const open = new Promise<void>((resolve) => {
          release = resolve;
        });

        return async () => {
          arrived += 1;
          if (arrived === 2) release();
          await open;
        };
      };
      const beforeOpening = barrier();
      const insideTransaction = barrier();

      const concurrently = (ctx: RequestContext) =>
        runWithContext(ctx, async () => {
          await beforeOpening();

          return openInRequestScope(harness.db.db)(async (tx) => {
            await insideTransaction();

            return everyMembership(tx);
          });
        });

      const member = createRequestContext({
        requestId: "rls-concurrent-member",
        logger: harness.logger,
      });

      member.principal = userPrincipal(ownerId);
      member.organization = { id: orgId, slug: "acme", role: "owner" };

      const staffInTeam = createRequestContext({
        requestId: "rls-concurrent-staff",
        logger: harness.logger,
      });

      staffInTeam.principal = staffPrincipal;
      staffInTeam.routeOrganizationId = team.id;

      const [acmeSeen, teamSeen] = await Promise.all([
        concurrently(member),
        concurrently(staffInTeam),
      ]);

      expect(acmeSeen.length).toBeGreaterThan(0);
      expect(acmeSeen.every((row) => row.organizationId === orgId)).toBe(true);
      expect(teamSeen.length).toBeGreaterThan(0);
      expect(teamSeen.every((row) => row.organizationId === team.id)).toBe(
        true,
      );

      // And on the wire, interleaved: each members list answers its own
      // organization's rows, never an empty page from the other's scope.
      const members = (token: string, id: string) =>
        request()
          .get(`${ORGS}/${id}/members`)
          .set("Authorization", bearer(token))
          .expect(200)
          .then(
            (response) => response.body.data as { organizationId: string }[],
          );

      const answers = await Promise.all(
        Array.from({ length: 8 }, (_, at) =>
          at % 2 === 0
            ? members(owner.accessToken, orgId).then((rows) => ({
                rows,
                id: orgId,
              }))
            : members(stranger.accessToken, team.id).then((rows) => ({
                rows,
                id: team.id,
              })),
        ),
      );

      for (const { rows, id } of answers) {
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((row) => row.organizationId === id)).toBe(true);
      }
    });
  });
});
