import type { OrganizationKind, OrganizationRole } from "@repo/contracts";
import { createLogger } from "@repo/logger";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createRequestContext,
  type RequestContext,
} from "../../../core/context/index.js";
import { isAppError } from "../../../core/errors/index.js";
import type { MembershipsRepository } from "../memberships.repository.js";
import type { OrganizationsRepository } from "../organizations.repository.js";
import { createOrganizationsService } from "../organizations.service.js";

/**
 * The organizations service against fake repositories (ADR-0021).
 *
 * Plain objects, no database: what this suite asserts is the *decisions* —
 * that every user-creating path ends with one personal organization and an
 * `owner` membership, that the last owner survives every write that would
 * remove them, and that a personal organization refuses a deletion of its own.
 * The transactional half of those claims — that the organization commits with
 * the account — is the integration suites' (`apps/api/test`), because a fake
 * `transaction` has no atomicity to lose.
 */

const NOW = new Date("2026-09-04T10:00:00.000Z");
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const ORG_ID = "33333333-3333-4333-8333-333333333333";

interface FakeOrganizationRow {
  id: string;
  slug: string;
  name: string;
  kind: OrganizationKind;
  createdBy: string;
  deletedAt: Date | null;
}

const ctx = (): RequestContext =>
  createRequestContext({
    requestId: "req-1",
    logger: createLogger({ level: "silent", name: "test" }),
  });

const createFakeOrganizations = (seed: FakeOrganizationRow[] = []) => {
  const rows = new Map(seed.map((row) => [row.id, { ...row }]));
  let nextId = 0;

  const toRecord = (row: FakeOrganizationRow) => ({
    ...row,
    createdAt: NOW,
    updatedAt: NOW,
  });

  const live = (row: FakeOrganizationRow) => row.deletedAt === null;

  const repository = {
    findById: (id: string) => {
      const row = rows.get(id);

      return Promise.resolve(
        row !== undefined && live(row) ? toRecord(row) : undefined,
      );
    },
    findBySlug: (slug: string) => {
      const row = [...rows.values()].find((r) => r.slug === slug && live(r));

      return Promise.resolve(row === undefined ? undefined : toRecord(row));
    },
    findPersonalFor: (userId: string) => {
      const row = [...rows.values()].find(
        (r) => r.createdBy === userId && r.kind === "personal" && live(r),
      );

      return Promise.resolve(row === undefined ? undefined : toRecord(row));
    },
    create: (input: {
      slug: string;
      name: string;
      kind: OrganizationKind;
      createdBy: string;
    }) => {
      // The partial unique index, as the fake: a *live* row holding the slug
      // is the conflict, a soft-deleted one is not.
      if ([...rows.values()].some((r) => r.slug === input.slug && live(r))) {
        return Promise.resolve(undefined);
      }

      nextId += 1;
      const row: FakeOrganizationRow = {
        id: `org-${String(nextId)}`,
        ...input,
        deletedAt: null,
      };

      rows.set(row.id, row);

      return Promise.resolve(toRecord(row));
    },
    softDelete: (id: string, at: Date) => {
      const row = rows.get(id);

      if (row === undefined || !live(row)) return Promise.resolve(false);

      row.deletedAt = at;

      return Promise.resolve(true);
    },
  };

  return {
    rows,
    repository: repository as unknown as OrganizationsRepository,
  } as const;
};

const createFakeMemberships = (
  seed: {
    organizationId: string;
    userId: string;
    role: OrganizationRole;
  }[] = [],
) => {
  const key = (organizationId: string, userId: string) =>
    `${organizationId}:${userId}`;

  const rows = new Map(
    seed.map((row) => [key(row.organizationId, row.userId), { ...row }]),
  );

  const calls = { lockOwnerInvariant: 0 };

  const repository = {
    findFor: (organizationId: string, userId: string) => {
      const row = rows.get(key(organizationId, userId));

      return Promise.resolve(
        row === undefined
          ? undefined
          : { ...row, createdAt: NOW, updatedAt: NOW },
      );
    },
    resolveFor: () => Promise.resolve(undefined),
    listForUser: () => Promise.resolve([]),
    create: (
      organizationId: string,
      userId: string,
      role: OrganizationRole,
    ) => {
      const k = key(organizationId, userId);

      if (rows.has(k)) return Promise.resolve(false);

      rows.set(k, { organizationId, userId, role });

      return Promise.resolve(true);
    },
    updateRole: (
      organizationId: string,
      userId: string,
      role: OrganizationRole,
    ) => {
      const row = rows.get(key(organizationId, userId));

      if (row === undefined) return Promise.resolve(false);

      row.role = role;

      return Promise.resolve(true);
    },
    remove: (organizationId: string, userId: string) =>
      Promise.resolve(rows.delete(key(organizationId, userId))),
    countOwnersExcept: (organizationId: string, exceptUserId: string) =>
      Promise.resolve(
        [...rows.values()].filter(
          (row) =>
            row.organizationId === organizationId &&
            row.role === "owner" &&
            row.userId !== exceptUserId,
        ).length,
      ),
    lockOwnerInvariant: () => {
      calls.lockOwnerInvariant += 1;

      return Promise.resolve();
    },
  };

  return {
    rows,
    calls,
    repository: repository as unknown as MembershipsRepository,
  } as const;
};

const build = (
  organizationSeed: FakeOrganizationRow[] = [],
  membershipSeed: {
    organizationId: string;
    userId: string;
    role: OrganizationRole;
  }[] = [],
) => {
  const organizations = createFakeOrganizations(organizationSeed);
  const memberships = createFakeMemberships(membershipSeed);

  const service = createOrganizationsService({
    repository: organizations.repository,
    memberships: memberships.repository,
    // The invitation surface is exercised end to end against real Postgres
    // (`apps/api/test/organizations.int.test.ts`), because what is worth
    // asserting about it — the atomic consume, the enumeration-safe create,
    // the `token_hash` no response carries — is a property of statements
    // rather than of this service's branching. Here it is a stub that would
    // throw if a case reached it.
    invitations: undefined as never,
    invitationTtlSec: 7 * 24 * 60 * 60,
    transaction: (fn) => fn(undefined as never),
    now: () => NOW,
  });

  return { service, organizations, memberships } as const;
};

const owner = {
  id: OWNER_ID,
  email: "cleo@machxi.local",
  firstName: "Cleo",
  lastName: "Customer",
} as const;

const failureOf = async (run: () => Promise<unknown>) => {
  const error: unknown = await run().then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

  if (!isAppError(error)) {
    throw new Error(`expected an AppError, got ${String(error)}`);
  }

  return error;
};

const team = (overrides: Partial<FakeOrganizationRow> = {}) => ({
  id: ORG_ID,
  slug: "acme",
  name: "Acme",
  kind: "team" as OrganizationKind,
  createdBy: OWNER_ID,
  deletedAt: null,
  ...overrides,
});

let clock: Date;

beforeEach(() => {
  clock = NOW;
});

/* ── the personal organization ────────────────────────────────────────────── */

describe("ensurePersonalOrganizationFor", () => {
  it("creates the organization and its owner membership", async () => {
    const { service, organizations, memberships } = build();

    const id = await service.ensurePersonalOrganizationFor(
      ctx(),
      owner,
      undefined as never,
    );

    const created = organizations.rows.get(id);

    expect(created).toMatchObject({
      kind: "personal",
      createdBy: OWNER_ID,
      // Derived from the account's id, so no pasted URL carries an address
      // (ADR-0067 §2) — and so this call is idempotent without a journal.
      slug: `personal-${OWNER_ID}`,
      name: "Cleo Customer",
    });

    expect([...memberships.rows.values()]).toEqual([
      { organizationId: id, userId: OWNER_ID, role: "owner" },
    ]);
  });

  it("names the organization after the address when the account has no name", async () => {
    const { service, organizations } = build();

    const id = await service.ensurePersonalOrganizationFor(
      ctx(),
      { ...owner, firstName: null, lastName: null },
      undefined as never,
    );

    expect(organizations.rows.get(id)?.name).toBe("cleo@machxi.local");
  });

  it("is idempotent: a second call creates no second organization", async () => {
    const { service, organizations, memberships } = build();

    const first = await service.ensurePersonalOrganizationFor(
      ctx(),
      owner,
      undefined as never,
    );
    const second = await service.ensurePersonalOrganizationFor(
      ctx(),
      owner,
      undefined as never,
    );

    expect(second).toBe(first);
    expect(organizations.rows.size).toBe(1);
    expect(memberships.rows.size).toBe(1);
  });
});

describe("deletePersonalOrganizationFor", () => {
  it("soft-deletes the account's personal organization with the account's own timestamp", async () => {
    const { service, organizations } = build();
    const id = await service.ensurePersonalOrganizationFor(
      ctx(),
      owner,
      undefined as never,
    );

    await service.deletePersonalOrganizationFor(
      ctx(),
      OWNER_ID,
      clock,
      undefined as never,
    );

    expect(organizations.rows.get(id)?.deletedAt).toEqual(clock);
  });

  it("leaves the team organizations the account owns alone", async () => {
    const { service, organizations } = build([team()]);

    await service.ensurePersonalOrganizationFor(
      ctx(),
      owner,
      undefined as never,
    );
    await service.deletePersonalOrganizationFor(
      ctx(),
      OWNER_ID,
      clock,
      undefined as never,
    );

    expect(organizations.rows.get(ORG_ID)?.deletedAt).toBeNull();
  });

  it("is silent when there is nothing to delete, so an account is always closeable", async () => {
    const { service } = build();

    await expect(
      service.deletePersonalOrganizationFor(
        ctx(),
        OWNER_ID,
        clock,
        undefined as never,
      ),
    ).resolves.toBeUndefined();
  });
});

/* ── the invariants ───────────────────────────────────────────────────────── */

describe("remove", () => {
  it("refuses a personal organization with 409", async () => {
    const { service, organizations } = build();
    const id = await service.ensurePersonalOrganizationFor(
      ctx(),
      owner,
      undefined as never,
    );

    const error = await failureOf(() => service.remove(ctx(), id));

    expect(error).toMatchObject({
      status: 409,
      code: "ORGANIZATION_PERSONAL_UNDELETABLE",
    });
    expect(organizations.rows.get(id)?.deletedAt).toBeNull();
  });

  it("soft-deletes a team organization", async () => {
    const { service, organizations } = build([team()]);

    await service.remove(ctx(), ORG_ID);

    expect(organizations.rows.get(ORG_ID)?.deletedAt).toEqual(NOW);
  });

  it("answers 404 for an organization that is already deleted", async () => {
    const { service } = build([team({ deletedAt: NOW })]);

    const error = await failureOf(() => service.remove(ctx(), ORG_ID));

    expect(error).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});

describe("the last owner", () => {
  const soleOwner = [
    { organizationId: ORG_ID, userId: OWNER_ID, role: "owner" as const },
  ];

  it("cannot be removed", async () => {
    const { service, memberships } = build([team()], soleOwner);

    const error = await failureOf(() =>
      service.removeMember(ctx(), ORG_ID, OWNER_ID, null),
    );

    expect(error).toMatchObject({
      status: 409,
      code: "ORGANIZATION_LAST_OWNER",
    });
    expect(memberships.rows.size).toBe(1);
    // The count that made the decision was taken behind the lock, which is
    // the whole reason the invariant holds under concurrency (ADR-0067 §2).
    expect(memberships.calls.lockOwnerInvariant).toBe(1);
  });

  it("cannot be demoted", async () => {
    const { service, memberships } = build([team()], soleOwner);

    const error = await failureOf(() =>
      service.setMemberRole(ctx(), ORG_ID, OWNER_ID, "admin"),
    );

    expect(error).toMatchObject({
      status: 409,
      code: "ORGANIZATION_LAST_OWNER",
    });
    expect(memberships.rows.get(`${ORG_ID}:${OWNER_ID}`)?.role).toBe("owner");
    expect(memberships.calls.lockOwnerInvariant).toBe(1);
  });

  it("may be removed once a second owner exists", async () => {
    const { service, memberships } = build(
      [team()],
      [
        ...soleOwner,
        { organizationId: ORG_ID, userId: OTHER_ID, role: "owner" as const },
      ],
    );

    await service.removeMember(ctx(), ORG_ID, OWNER_ID, null);

    expect([...memberships.rows.values()]).toEqual([
      { organizationId: ORG_ID, userId: OTHER_ID, role: "owner" },
    ]);
  });
});

describe("membership writes", () => {
  it("takes the owner lock before reading the role, not after", async () => {
    const { service, memberships } = build(
      [team()],
      [
        { organizationId: ORG_ID, userId: OWNER_ID, role: "owner" },
        { organizationId: ORG_ID, userId: OTHER_ID, role: "member" },
      ],
    );

    await service.removeMember(ctx(), ORG_ID, OTHER_ID, null);

    expect(memberships.rows.has(`${ORG_ID}:${OTHER_ID}`)).toBe(false);
    // Taken even though the member being removed is not an owner — which is
    // the point. A removal that reads `member` and skips the lock can still
    // empty an organization: by the time it deletes, that member may have been
    // promoted and the previous sole owner removed by a request that counted
    // this one as the survivor. The lock covers the read, not just the count.
    expect(memberships.calls.lockOwnerInvariant).toBe(1);
  });

  it("promotes a member to owner", async () => {
    const { service, memberships } = build(
      [team()],
      [
        { organizationId: ORG_ID, userId: OWNER_ID, role: "owner" },
        { organizationId: ORG_ID, userId: OTHER_ID, role: "member" },
      ],
    );

    await service.setMemberRole(ctx(), ORG_ID, OTHER_ID, "owner");

    expect(memberships.rows.get(`${ORG_ID}:${OTHER_ID}`)?.role).toBe("owner");
  });

  it("answers 404 for an account with no membership", async () => {
    const { service } = build([team()], []);

    const error = await failureOf(() =>
      service.removeMember(ctx(), ORG_ID, OTHER_ID, null),
    );

    expect(error).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("answers 404 when the organization is soft-deleted, memberships and all", async () => {
    // Memberships survive an organization's soft delete — nothing cascades on
    // it — so a write that read the membership table alone would succeed
    // inside a deleted tenant (`D15.1`'s note to this step).
    const { service } = build(
      [team({ deletedAt: NOW })],
      [
        { organizationId: ORG_ID, userId: OWNER_ID, role: "owner" },
        { organizationId: ORG_ID, userId: OTHER_ID, role: "member" },
      ],
    );

    const error = await failureOf(() =>
      service.removeMember(ctx(), ORG_ID, OTHER_ID, null),
    );

    expect(error).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});
