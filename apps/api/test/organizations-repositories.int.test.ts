import {
  organizationInvitations,
  organizationMemberships,
  organizations,
  personalOrganizationSlug,
  users,
} from "@repo/db";
import { randomToken, sha256Base64url } from "@repo/crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ListQuery } from "@repo/contracts";

import {
  createInvitationsRepository,
  createMembershipsRepository,
  createOrganizationsRepository,
} from "../src/modules/organizations/index.js";
import { createTestApp, type TestApp } from "./support/app.js";
import { FIXTURE_USERS, resetAndSeed } from "./support/seed.js";

/**
 * The organizations module's three repositories against real Postgres
 * (ADR-0021, ADR-0067 §1 and §2).
 *
 * The module core lands a step ahead of the routes that call it, so every
 * function here would otherwise reach production having never been executed —
 * and a query that no test runs is a query nobody has checked *parses*. This
 * file exists to close that: it runs each one at least once and asserts the
 * behaviour the record fixes. The endpoints that compose them arrive with
 * their own suite.
 *
 * It earned its keep on the day it was written. `listPendingForEmail` was a
 * relational `findMany` carrying a **correlated** `exists` subquery, which the
 * relational builder aliases out of scope: every call failed with `42P01`,
 * for any input, and the whole five-link gate was green because nothing called
 * it yet.
 */

describe("the organizations repositories", () => {
  let harness: TestApp;
  let ownerId: string;
  let memberId: string;
  let orgId: string;

  const at = () => new Date();

  /** The default page a list endpoint's schema would produce (ADR-0014). */
  const page = (): ListQuery => ({
    offset: 0,
    limit: 20,
    sort: [{ field: "createdAt", direction: "desc" }],
    filters: [],
    count: true,
  });

  /**
   * A distinct slug or address per case. A counter rather than
   * `randomToken`, whose floor is 16 bytes — this needs uniqueness within one
   * file, not entropy.
   */
  let sequence = 0;
  const unique = (prefix: string) => {
    sequence += 1;

    return `${prefix}-${String(sequence)}`;
  };

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ db: harness.db, hasher: harness.hasher });

    const [owner] = await harness.db.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, FIXTURE_USERS.active));
    const [member] = await harness.db.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, FIXTURE_USERS.pending));

    ownerId = owner?.id ?? "";
    memberId = member?.id ?? "";

    // The `acme` team organization the dev seeders create (`D15.1`).
    const [acme] = await harness.db.db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, "acme"));

    orgId = acme?.id ?? "";

    expect(ownerId).not.toBe("");
    expect(memberId).not.toBe("");
    expect(orgId).not.toBe("");
  });

  afterAll(async () => {
    await harness.close();
  });

  const repositories = () => ({
    organizations: createOrganizationsRepository(harness.db.db),
    memberships: createMembershipsRepository(harness.db.db),
    invitations: createInvitationsRepository(harness.db.db),
  });

  /* ── organizations ──────────────────────────────────────────────────────── */

  it("reads a live organization by id, by slug and by owner", async () => {
    const repo = repositories().organizations;

    expect(await repo.findById(orgId)).toMatchObject({ slug: "acme" });
    expect(await repo.findBySlug("acme")).toMatchObject({ id: orgId });
    expect(await repo.findPersonalFor(ownerId)).toMatchObject({
      kind: "personal",
      slug: personalOrganizationSlug(ownerId),
    });
  });

  it("refuses a second live organization on the same slug and releases it on delete", async () => {
    const repo = repositories().organizations;
    const slug = unique("repo-probe");

    const first = await repo.create({
      slug,
      name: "Repo Probe",
      kind: "team",
      createdBy: ownerId,
    });

    expect(first).toBeDefined();

    // The conflict target names the *partial* index's predicate; without it
    // the insert matches no index and escapes as a 500 (ADR-0067 §2).
    expect(
      await repo.create({
        slug,
        name: "Repo Probe Again",
        kind: "team",
        createdBy: ownerId,
      }),
    ).toBeUndefined();

    expect(await repo.softDelete(first?.id ?? "", at())).toBe(true);
    // A second soft delete matches no live row, which is what sees a
    // concurrent delete.
    expect(await repo.softDelete(first?.id ?? "", at())).toBe(false);
    expect(await repo.findById(first?.id ?? "")).toBeUndefined();

    // Deleting released the slug — the trade ADR-0067 §2 takes deliberately.
    const reused = await repo.create({
      slug,
      name: "Repo Probe Reborn",
      kind: "team",
      createdBy: ownerId,
    });

    expect(reused).toBeDefined();
    await repo.softDelete(reused?.id ?? "", at());
  });

  /* ── memberships ────────────────────────────────────────────────────────── */

  it("resolves a membership with its organization's slug, and only while it is live", async () => {
    const { memberships, organizations: repo } = repositories();

    expect(await memberships.resolveFor(orgId, ownerId)).toMatchObject({
      organizationId: orgId,
      slug: "acme",
      role: "owner",
    });

    // A membership of an organization that does not exist resolves to nothing,
    // which is what the guard turns into a `404`.
    expect(
      await memberships.resolveFor(
        "00000000-0000-4000-8000-000000000000",
        ownerId,
      ),
    ).toBeUndefined();

    const throwaway = await repo.create({
      slug: unique("resolve-probe"),
      name: "Resolve Probe",
      kind: "team",
      createdBy: ownerId,
    });
    const id = throwaway?.id ?? "";

    await memberships.create(id, ownerId, "owner");
    expect(await memberships.resolveFor(id, ownerId)).toBeDefined();

    await repo.softDelete(id, at());

    // The membership row survives the soft delete — nothing cascades on it —
    // and the join is what stops it resolving inside a deleted tenant.
    expect(await memberships.findFor(id, ownerId)).toBeDefined();
    expect(await memberships.resolveFor(id, ownerId)).toBeUndefined();
    expect(
      (await memberships.listForUser(ownerId)).some(
        (row) => row.organization.id === id,
      ),
    ).toBe(false);
  });

  it("counts only owners whose account is still open", async () => {
    const { memberships, organizations: repo } = repositories();

    const created = await repo.create({
      slug: unique("owners-probe"),
      name: "Owners Probe",
      kind: "team",
      createdBy: ownerId,
    });
    const id = created?.id ?? "";

    await memberships.create(id, ownerId, "owner");
    await memberships.create(id, memberId, "owner");

    expect(await memberships.countOwnersExcept(id, ownerId)).toBe(1);

    // Close the second owner's account. Its **team** memberships stay — only
    // the personal organization goes with it (ADR-0067 §2) — so a count of
    // this table alone would still see an owner, and the last live owner could
    // leave an organization nobody can administer.
    await harness.db.db
      .update(users)
      .set({ deletedAt: at() })
      .where(eq(users.id, memberId));

    try {
      expect(await memberships.countOwnersExcept(id, ownerId)).toBe(0);
    } finally {
      await harness.db.db
        .update(users)
        .set({ deletedAt: null })
        .where(eq(users.id, memberId));
    }

    await repo.softDelete(id, at());
  });

  it("takes the owner-invariant lock inside a transaction", async () => {
    const { memberships } = repositories();

    // `pg_advisory_xact_lock(int4, int4)` over `hashtext(uuid)` — run once so
    // the statement is known to parse and the lock class is known to be in the
    // two-argument space, disjoint from the staff invariant's.
    await expect(
      harness.db.db.transaction((tx) =>
        memberships.lockOwnerInvariant(orgId, tx),
      ),
    ).resolves.toBeUndefined();
  });

  it("updates and removes a membership, reporting whether anything changed", async () => {
    const { memberships, organizations: repo } = repositories();

    const created = await repo.create({
      slug: unique("member-probe"),
      name: "Member Probe",
      kind: "team",
      createdBy: ownerId,
    });
    const id = created?.id ?? "";

    expect(await memberships.create(id, memberId, "member")).toBe(true);
    // The composite primary key is the conflict target, so this is idempotent.
    expect(await memberships.create(id, memberId, "member")).toBe(false);

    expect(await memberships.updateRole(id, memberId, "admin", at())).toBe(
      true,
    );
    expect(await memberships.findFor(id, memberId)).toMatchObject({
      role: "admin",
    });

    expect(await memberships.remove(id, memberId)).toBe(true);
    // The boolean is what sees a concurrent removal.
    expect(await memberships.remove(id, memberId)).toBe(false);
    expect(await memberships.updateRole(id, memberId, "member", at())).toBe(
      false,
    );

    await repo.softDelete(id, at());
  });

  /* ── invitations ────────────────────────────────────────────────────────── */

  const invite = async (
    organizationId: string,
    email: string,
    expiresAt = new Date(Date.now() + 3_600_000),
  ) =>
    repositories().invitations.create(organizationId, {
      email,
      role: "member",
      invitedBy: ownerId,
      // Minted per row, never a literal: a constant digest in a fixture is one
      // shared credential across every clone (ADR-0067 §2, amended).
      tokenHash: sha256Base64url(randomToken()),
      expiresAt,
    });

  it("creates an invitation and never returns its token hash", async () => {
    const created = await invite(orgId, `${unique("probe")}@machxi.local`);

    expect(created).toMatchObject({ organizationId: orgId, role: "member" });
    expect(Object.keys(created)).not.toContain("tokenHash");
    expect(JSON.stringify(created)).not.toContain("tokenHash");

    expect(
      await repositories().invitations.findById(orgId, created.id),
    ).toMatchObject({ id: created.id });

    // Scoped: another organization's id does not reach this row.
    expect(
      await repositories().invitations.findById(
        "00000000-0000-4000-8000-000000000000",
        created.id,
      ),
    ).toBeUndefined();

    await repositories().invitations.consume(
      orgId,
      created.id,
      "revokedAt",
      at(),
    );
  });

  it("lists what is pending, by organization and by address", async () => {
    const repo = repositories().invitations;
    const email = `${unique("pending")}@machxi.local`;
    const pending = await invite(orgId, email);
    const expired = await invite(
      orgId,
      `${unique("expired")}@machxi.local`,
      new Date(Date.now() - 1_000),
    );

    const forOrg = await repo.listPendingFor(orgId, page(), at());

    expect(forOrg.rows.map((row) => row.id)).toContain(pending.id);
    // The row's state is its timestamps — `expired` is a fact no column holds,
    // so it is a predicate on `expires_at` and nothing else.
    expect(forOrg.rows.map((row) => row.id)).not.toContain(expired.id);
    // The join carries the organization's name, which is what the invitee's
    // own list renders without a second request.
    expect(forOrg.rows[0]?.organizationName).toBe("Acme Inc.");

    const forEmail = await repo.listPendingForEmail(email, at());

    expect(forEmail.map((row) => row.id)).toEqual([pending.id]);
    // `citext`, so an invitation matches however either side typed it.
    expect(
      (await repo.listPendingForEmail(email.toUpperCase(), at())).map(
        (row) => row.id,
      ),
    ).toEqual([pending.id]);

    await repo.consume(orgId, pending.id, "revokedAt", at());
  });

  it("consumes an invitation exactly once, and never into a deleted tenant", async () => {
    const { invitations, organizations: repo } = repositories();
    const email = `${unique("consume")}@machxi.local`;
    const created = await invite(orgId, email);

    const accepted = await invitations.consume(
      orgId,
      created.id,
      "acceptedAt",
      at(),
    );

    expect(accepted?.acceptedAt).toBeInstanceOf(Date);
    // Single use needs no column of its own: the terminal stamps are in the
    // `where` clause of the statement that writes one, so a second consume
    // matches nothing (ADR-0067 §2).
    expect(
      await invitations.consume(orgId, created.id, "declinedAt", at()),
    ).toBeUndefined();

    const throwaway = await repo.create({
      slug: unique("invite-probe"),
      name: "Invite Probe",
      kind: "team",
      createdBy: ownerId,
    });
    const id = throwaway?.id ?? "";
    const orphan = await invite(id, `${unique("orphan")}@machxi.local`);

    await repo.softDelete(id, at());

    // The row itself outlives its organization's soft delete — nothing
    // cascades on one — which is the fact every read here is defending
    // against.
    const [survivor] = await harness.db.db
      .select({ id: organizationInvitations.id })
      .from(organizationInvitations)
      .where(eq(organizationInvitations.id, orphan.id));

    expect(survivor).toBeDefined();

    // And no read returns it, because every one of them joins `organizations`
    // and filters `deleted_at` — so an invitation into a deleted tenant is not
    // pending, it is void.
    expect(await invitations.findById(id, orphan.id)).toBeUndefined();
    expect(
      await invitations.consume(id, orphan.id, "acceptedAt", at()),
    ).toBeUndefined();
    expect(
      await invitations.listPendingForEmail(orphan.email, at()),
    ).toHaveLength(0);
  });

  afterAll(async () => {
    // Leave the seeded fixtures as this file found them: the suite runs
    // serially, but a stray team organization would still show up in the next
    // file's counts.
    await harness.db.db
      .delete(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.userId, memberId),
          eq(organizationMemberships.role, "member"),
        ),
      );
  });
});
