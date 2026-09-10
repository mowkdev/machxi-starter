import { organizationInvitations } from "@repo/db";
import { eq } from "drizzle-orm";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bearer,
  login,
  NEW_ACCOUNT_PASSWORD,
  type Tokens,
} from "./support/actors.js";
import { createTestApp, type TestApp } from "./support/app.js";
import { lastMailTo, registerVerified, tokenFromMail } from "./support/mail.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_USERS,
  resetAndSeed,
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
    await resetAndSeed({ db: harness.db, hasher: harness.container.hasher });

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

      const [row] = await harness.db.db
        .select({ tokenHash: organizationInvitations.tokenHash })
        .from(organizationInvitations)
        .where(eq(organizationInvitations.id, created.body.data.id));

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
      await harness.db.db
        .update(organizationInvitations)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(organizationInvitations.id, created.body.data.id));

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
        const [row] = await harness.db.db
          .select({ tokenHash: organizationInvitations.tokenHash })
          .from(organizationInvitations)
          .where(eq(organizationInvitations.id, created.body.data.id));

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

        await harness.db.db
          .update(organizationInvitations)
          .set({ expiresAt: new Date(Date.now() - 1000) })
          .where(eq(organizationInvitations.id, expired.id));

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
});
