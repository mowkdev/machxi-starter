import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  FEDERATED_PROVIDERS,
  POPULATIONS,
  STAFF_ROLES,
  STAFF_STATUSES,
  TOKEN_PURPOSES,
  USER_ROLES,
  USER_STATUSES,
} from "@repo/contracts";

import {
  accountTokens,
  auditActorTypeEnum,
  auditEvents,
  federatedIdentities,
  federatedProviderEnum,
  impersonationHandoffs,
  principalTypeEnum,
  sessions,
  staff,
  staffRoleEnum,
  staffRoles,
  staffStatusEnum,
  tokenPurposeEnum,
  userRoleEnum,
  userRoles,
  users,
  userStatusEnum,
} from "../index.js";

/**
 * Structural assertions on the schema (ADR-0006, ADR-0017, ADR-0018).
 *
 * These check the shape a migration would be generated from, not a live
 * database — `schema.int.test.ts` does that against real Postgres. The
 * division matters: a nullability or enum-order mistake caught here never
 * reaches a migration, and once a migration is committed it is never edited
 * (ADR-0008).
 */

const columnsOf = (table: Parameters<typeof getTableConfig>[0]) =>
  new Map(getTableConfig(table).columns.map((column) => [column.name, column]));

describe("enums", () => {
  it.each([
    ["staff_role", staffRoleEnum, STAFF_ROLES],
    ["staff_status", staffStatusEnum, STAFF_STATUSES],
    ["user_role", userRoleEnum, USER_ROLES],
    ["user_status", userStatusEnum, USER_STATUSES],
    ["principal_type", principalTypeEnum, POPULATIONS],
    // The same tuple behind two Postgres types, on purpose (ADR-0058): a live
    // session and a recorded fact must be free to grow apart.
    ["audit_actor_type", auditActorTypeEnum, POPULATIONS],
    ["token_purpose", tokenPurposeEnum, TOKEN_PURPOSES],
    ["federated_provider", federatedProviderEnum, FEDERATED_PROVIDERS],
  ])(
    "%s mirrors its @repo/contracts tuple, in order",
    (name, pgEnum, contractValues) => {
      expect(pgEnum.enumName).toBe(name);
      // Order, not just membership: Postgres sorts an enum column by label
      // position, so this is what pins what `ORDER BY status` returns
      // (ADR-0014). Reordering the tuple in @repo/contracts is a schema change.
      expect(pgEnum.enumValues).toEqual([...contractValues]);
    },
  );
});

describe("staff", () => {
  const columns = columnsOf(staff);

  it("is the table the admin segment administers", () => {
    expect(getTableConfig(staff).name).toBe("staff");
  });

  it("stores email as citext, unique and not null (ADR-0017)", () => {
    const email = columns.get("email");

    expect(email?.getSQLType()).toBe("citext");
    expect(email?.notNull).toBe(true);
    expect(email?.isUnique).toBe(true);
  });

  it("requires both names but no longer a password hash (ADR-0071 §8)", () => {
    // Nullable since `D18.1`: an `invited` operator has no password at all
    // until they consume the onboarding token, which is better than a
    // placeholder hash somebody had to invent — that would leave a verifiable
    // digest on a row nobody has proved anything about, and make `invited`
    // indistinguishable from `active` at the column.
    expect(columns.get("passwordHash")?.notNull).toBe(false);
    expect(columns.get("firstName")?.notNull).toBe(true);
    expect(columns.get("lastName")?.notNull).toBe(true);
  });

  it("defaults status to active and leaves lastLoginAt null", () => {
    expect(columns.get("status")?.default).toBe("active");
    expect(columns.get("lastLoginAt")?.notNull).toBe(false);
  });

  it("has no soft-delete column — only users do (ADR-0006)", () => {
    expect(columns.has("deletedAt")).toBe(false);
  });
});

describe("users", () => {
  const columns = columnsOf(users);

  it("allows a null password hash for the future passwordless path (ADR-0018)", () => {
    expect(columns.get("passwordHash")?.notNull).toBe(false);
  });

  it("allows null names, unlike staff (ADR-0017)", () => {
    expect(columns.get("firstName")?.notNull).toBe(false);
    expect(columns.get("lastName")?.notNull).toBe(false);
  });

  it("is soft-deletable", () => {
    expect(columns.get("deletedAt")?.notNull).toBe(false);
    expect(columns.has("deletedAt")).toBe(true);
  });

  it("records when the address was proven, and leaves it null (ADR-0071 §3)", () => {
    // Nullable with no default is the decision, not an oversight: `null` is
    // what a `pending_verification` row carries, and a defaulted column would
    // make every account claim a proof nobody gave.
    expect(columns.get("emailVerifiedAt")?.notNull).toBe(false);
    expect(columns.get("emailVerifiedAt")?.hasDefault).toBe(false);
    expect(columns.get("emailVerifiedAt")?.getSQLType()).toBe(
      "timestamp with time zone",
    );
  });
});

describe("account_tokens", () => {
  const config = getTableConfig(accountTokens);
  const columns = columnsOf(accountTokens);

  it("carries no foreign key, like the other two credential tables", () => {
    // Postgres cannot express "references staff or users depending on
    // principal_type" (ADR-0018), staff are hard-deleted (ADR-0028), and a
    // consumed row is the record of a mint that happened. Every consume looks
    // its principal up itself.
    expect(config.foreignKeys).toHaveLength(0);
  });

  it("stores only the hash of the token, uniquely (ADR-0071 §1)", () => {
    // The `sessions.refresh_token_hash` storage form, for the reason that
    // column has it: a database read must not yield a usable credential.
    expect(columns.has("token")).toBe(false);
    expect(columns.get("tokenHash")?.notNull).toBe(true);
    expect(columns.get("tokenHash")?.isUnique).toBe(true);
  });

  it("names the purpose and the principal, and requires all three", () => {
    expect(columns.get("purpose")?.notNull).toBe(true);
    expect(columns.get("principalType")?.notNull).toBe(true);
    expect(columns.get("principalId")?.notNull).toBe(true);
  });

  it("makes single use a column, not a convention", () => {
    // `consumed_at` nullable is what lets a consume be atomic — `update …
    // where consumed_at is null returning` — so a replay updates no row rather
    // than being caught by a check the caller might forget.
    expect(columns.get("expiresAt")?.notNull).toBe(true);
    expect(columns.get("consumedAt")?.notNull).toBe(false);
  });

  it("carries an optional jsonb payload for the one flow that needs one", () => {
    // `change_email` and nothing else (ADR-0071 §6). A nullable `new_email`
    // column per flow is how a shared table stops being one.
    expect(columns.get("payload")?.notNull).toBe(false);
    expect(columns.get("payload")?.getSQLType()).toBe("jsonb");
  });

  it("indexes the re-mint lookup and both halves of the sweep", () => {
    expect(config.indexes.map((index) => index.config.name).sort()).toEqual([
      // Partial on `consumed_at is not null` since `D28.4` (`DB-07`): the
      // sweep is `expires_at < cutoff OR consumed_at < cutoff`, a BitmapOr
      // only when both sides are indexed.
      "account_tokens_consumed_at_idx",
      "account_tokens_expires_at_idx",
      "account_tokens_principal_purpose_idx",
    ]);
  });

  it("leads the lookup index with the principal, not the purpose", () => {
    // The selective half: a deployment has four purposes and as many
    // principals as it has accounts.
    const index = config.indexes.find(
      (candidate) =>
        candidate.config.name === "account_tokens_principal_purpose_idx",
    );

    // `"name" in column` because an index entry may be a raw `SQL` expression
    // rather than a column, and drizzle types the array as the union. Nothing
    // here declares one — the fallback exists so the assertion reads the
    // shape rather than asserting a cast.
    //
    // TS property names, like `columnsOf` above: `casing: "snake_case"` is
    // applied by drizzle-kit when it writes the SQL, so the objects in the
    // schema still carry the camelCase keys.
    expect(
      index?.config.columns.map((column) =>
        "name" in column ? column.name : "(expression)",
      ),
    ).toEqual(["principalType", "principalId", "purpose"]);
  });
});

describe("federated_identities", () => {
  const config = getTableConfig(federatedIdentities);
  const columns = columnsOf(federatedIdentities);

  /** A unique constraint's columns by TS property name, as `columnsOf` keys them. */
  const uniqueColumns = () =>
    config.uniqueConstraints.map((constraint) =>
      constraint.columns.map((column) => column.name),
    );

  it("is unique on (provider, subject): one provider account, one user (ADR-0072 §1)", () => {
    // The sign-in's lookup, and the reason a subject can never become a second
    // way into somebody else's account.
    expect(uniqueColumns()).toContainEqual(["provider", "subject"]);
  });

  it("is unique on (user_id, provider): one identity per provider per user (ADR-0072 §1)", () => {
    // "Unlink Google" names one row, and a second link on an account that has
    // one is refused by the database as well as by the service.
    expect(uniqueColumns()).toContainEqual(["userId", "provider"]);
  });

  it("has exactly those two constraints, both named, and no other index", () => {
    // Named, for the reason `account_tokens` names its own: an unnamed
    // constraint takes the TS property names into a snake_case database. The
    // (user_id, provider) constraint leads with the reference, so it is the
    // foreign key's index too and nothing else is declared.
    expect(
      config.uniqueConstraints.map((constraint) => constraint.name).sort(),
    ).toEqual([
      "federated_identities_provider_subject_unique",
      "federated_identities_user_id_provider_unique",
    ]);
    expect(config.indexes).toHaveLength(0);
  });

  it("references users — a real foreign key, because it names one population", () => {
    // The credential tables cannot carry one (they discriminate staff from
    // users); this one can, and a hard delete would take the row with it.
    const [reference] = config.foreignKeys.map((fk) => fk.reference());

    expect(config.foreignKeys).toHaveLength(1);
    expect(reference?.foreignTable).toBe(users);
    expect(reference?.columns.map((column) => column.name)).toEqual(["userId"]);
    expect(config.foreignKeys[0]?.onDelete).toBe("cascade");
  });

  it("requires the user, the provider and the subject, and nothing about the address", () => {
    expect(columns.get("userId")?.notNull).toBe(true);
    expect(columns.get("provider")?.notNull).toBe(true);
    expect(columns.get("subject")?.notNull).toBe(true);
    // Informational and never a lookup key after the link (ADR-0072 §1), so a
    // provider that reports none still links.
    expect(columns.get("email")?.notNull).toBe(false);
    expect(columns.get("email")?.getSQLType()).toBe("citext");
  });

  it("stamps the link and leaves the first later sign-in null", () => {
    expect(columns.get("linkedAt")?.notNull).toBe(true);
    expect(columns.get("linkedAt")?.hasDefault).toBe(true);
    expect(columns.get("lastLoginAt")?.notNull).toBe(false);
  });

  it("keeps no credential: no token, no password, no secret column", () => {
    // What proves the identity is the provider's signed assertion at each
    // sign-in (ADR-0072 §2), not anything stored here — so a read of this
    // table yields nobody's way in.
    expect(
      [...columns.keys()].filter((name) =>
        /token|secret|password|hash/i.test(name),
      ),
    ).toEqual([]);
  });
});

describe("role join tables", () => {
  it("key staff_roles on (staff_id, role) so a repeated grant is a no-op", () => {
    const [primaryKey] = getTableConfig(staffRoles).primaryKeys;

    expect(primaryKey?.columns.map((column) => column.name)).toEqual([
      "staffId",
      "role",
    ]);
  });

  it("key user_roles on (user_id, role)", () => {
    const [primaryKey] = getTableConfig(userRoles).primaryKeys;

    expect(primaryKey?.columns.map((column) => column.name)).toEqual([
      "userId",
      "role",
    ]);
  });

  it("cascade a grant away with its account, but keep it when the granter goes", () => {
    const byColumn = new Map(
      getTableConfig(staffRoles)
        .foreignKeys.map((fk) => fk.reference())
        .map((reference) => [
          reference.columns[0]?.name,
          reference.foreignTable,
        ]),
    );

    expect(byColumn.has("staffId")).toBe(true);
    expect(byColumn.has("grantedBy")).toBe(true);

    const onDelete = getTableConfig(staffRoles).foreignKeys.map(
      (fk) => fk.onDelete,
    );

    expect(new Set(onDelete)).toEqual(new Set(["cascade", "set null"]));
  });
});

describe("sessions", () => {
  const config = getTableConfig(sessions);
  const columns = columnsOf(sessions);

  it("carries no foreign key on principal_id (ADR-0018)", () => {
    // Postgres cannot express "references staff or users depending on
    // principal_type"; the discriminator plus the service's revoke-on-delete
    // is the substitute, and a FK appearing here would mean somebody picked a
    // single population by accident.
    expect(config.foreignKeys).toHaveLength(0);
  });

  it("stores only the hash of a refresh token, uniquely", () => {
    expect(columns.has("refreshToken")).toBe(false);
    expect(columns.get("refreshTokenHash")?.notNull).toBe(true);
    expect(columns.get("refreshTokenHash")?.isUnique).toBe(true);
  });

  it("keeps the rotated-out hash nullable, for the grace window and reuse detection", () => {
    expect(columns.get("previousRefreshTokenHash")?.notNull).toBe(false);
    expect(columns.get("rotatedAt")?.notNull).toBe(false);
  });

  it("indexes the principal, the previous hash, the expiry, the revocation and the impersonator", () => {
    expect(config.indexes.map((index) => index.config.name).sort()).toEqual([
      // Partial (`where impersonated_by_staff_id is not null`) since
      // ADR-0060 §4: the column is null on every ordinary session, so the
      // predicate indexes the rows `revokeAllImpersonatedBy` is about and
      // nothing else.
      "sessions_impersonated_by_staff_id_idx",
      "sessions_previous_refresh_token_hash_idx",
      "sessions_principal_idx",
      "sessions_refresh_token_expires_at_idx",
      // The prune's other half, partial on `revoked_at is not null` since
      // `D28.4` (`DB-07`).
      "sessions_revoked_at_idx",
    ]);
  });

  it("makes the impersonator index partial rather than table-wide", () => {
    const index = config.indexes.find(
      (candidate) =>
        candidate.config.name === "sessions_impersonated_by_staff_id_idx",
    );

    expect(index?.config.where).toBeDefined();
  });

  it("records revocation as a timestamp plus a reason, not a boolean", () => {
    expect(columns.get("revokedAt")?.notNull).toBe(false);
    expect(columns.get("revokedReason")?.notNull).toBe(false);
  });

  it("carries the impersonating staff id, nullable and unreferenced (ADR-0057 §4)", () => {
    // Nullable because it is null on every ordinary session — its presence is
    // what makes a session impersonated. Unreferenced because staff are
    // *hard*-deleted (ADR-0028), and attribution that disappears with its
    // actor is not attribution; the `foreignKeys` assertion above is what
    // pins that, and it still reads zero.
    expect(columns.get("impersonatedByStaffId")?.notNull).toBe(false);
    expect(columns.get("impersonatedByStaffId")?.getSQLType()).toBe("uuid");
  });
});

describe("impersonation_handoffs", () => {
  const config = getTableConfig(impersonationHandoffs);
  const columns = columnsOf(impersonationHandoffs);

  it("carries no foreign key either (ADR-0057 §2)", () => {
    // The `sessions` reason and one more: a consumed row is the record of a
    // mint that happened, and the exchange looks both accounts up itself
    // rather than joining to them.
    expect(config.foreignKeys).toHaveLength(0);
  });

  it("stores only the hash of the token, uniquely", () => {
    // The same shape as `sessions.refresh_token_hash`, for the same reason: a
    // database read must not yield a usable credential.
    expect(columns.has("token")).toBe(false);
    expect(columns.get("tokenHash")?.notNull).toBe(true);
    expect(columns.get("tokenHash")?.isUnique).toBe(true);
  });

  it("names both identities and requires them", () => {
    expect(columns.get("staffId")?.notNull).toBe(true);
    expect(columns.get("userId")?.notNull).toBe(true);
  });

  it("makes single use a column, not a convention", () => {
    // `consumed_at` nullable is what lets the exchange consume atomically —
    // `update … where consumed_at is null returning` — so a replay updates no
    // row rather than being caught by a check the caller might forget.
    expect(columns.get("expiresAt")?.notNull).toBe(true);
    expect(columns.get("consumedAt")?.notNull).toBe(false);
  });

  it("indexes both halves of what the sweep scans", () => {
    expect(config.indexes.map((index) => index.config.name).sort()).toEqual([
      // Partial on `consumed_at is not null` since `D28.4` (`DB-07`).
      "impersonation_handoffs_consumed_at_idx",
      "impersonation_handoffs_expires_at_idx",
    ]);
  });
});

describe("audit_events", () => {
  const config = getTableConfig(auditEvents);
  const columns = columnsOf(auditEvents);

  it("carries no foreign key at all (ADR-0058)", () => {
    // Stronger than `sessions`, which *cannot* have one: this table *must*
    // not, because a row has to outlive the hard deletion of the actor and
    // the subject it names. A FK appearing here would delete the log exactly
    // when an incident needs it.
    expect(config.foreignKeys).toHaveLength(0);
  });

  it("requires an actor and leaves acting-as nullable", () => {
    expect(columns.get("actorType")?.notNull).toBe(true);
    expect(columns.get("actorId")?.notNull).toBe(true);
    // Null is the ordinary case: `acting_as` is set only when the human and
    // the account differ, which is impersonation and nothing else.
    expect(columns.get("actingAsType")?.notNull).toBe(false);
    expect(columns.get("actingAsId")?.notNull).toBe(false);
  });

  it("names the event as free text, not an enum (ADR-0058)", () => {
    // The names live with their writers in `apps/api`; a contracts enum would
    // put server-only vocabulary on the wire for no reader.
    expect(columns.get("event")?.notNull).toBe(true);
    expect(columns.get("event")?.getSQLType()).toBe("text");
  });

  it("has one time column and no updated_at", () => {
    expect(columns.get("occurredAt")?.notNull).toBe(true);
    expect(columns.get("occurredAt")?.getSQLType()).toBe(
      "timestamp with time zone",
    );
    // `updated_at` on an append-only table is a contradiction, and this is
    // what keeps a later `...timestamps()` from being spread in by habit.
    expect(columns.has("updatedAt")).toBe(false);
    expect(columns.has("createdAt")).toBe(false);
  });

  it("indexes the actor, the subject and the event by time, and time alone", () => {
    expect(config.indexes.map((index) => index.config.name).sort()).toEqual([
      // "Everything done **to** this account" — the question an incident asks
      // second, which the actor index cannot answer (ADR-0060 §4).
      "audit_events_acting_as_idx",
      "audit_events_actor_idx",
      "audit_events_event_idx",
      // `occurred_at` alone, for the one job that reads this table by time
      // and not by who: retention.
      "audit_events_occurred_at_idx",
    ]);
  });
});

describe("shared column helpers", () => {
  it.each([
    ["staff", staff],
    ["users", users],
    ["sessions", sessions],
    // A mutable row — the consume writes `consumed_at` — so it takes the pair
    // like every other table; `audit_events` is the one documented exception.
    ["impersonation_handoffs", impersonationHandoffs],
    // Mutable for the same reason: the consume writes `consumed_at`.
    ["account_tokens", accountTokens],
    // Mutable: a sign-in writes `last_login_at`.
    ["federated_identities", federatedIdentities],
  ])("gives %s created_at and updated_at, both defaulted", (_name, table) => {
    const columns = columnsOf(table);

    for (const name of ["createdAt", "updatedAt"]) {
      expect(columns.get(name)?.notNull).toBe(true);
      expect(columns.get(name)?.hasDefault).toBe(true);
      expect(columns.get(name)?.getSQLType()).toBe("timestamp with time zone");
    }
  });

  it.each([
    ["staff", staff],
    ["users", users],
    ["sessions", sessions],
  ])("gives %s a uuid primary key generated app-side as v7", (_name, table) => {
    const id = columnsOf(table).get("id");

    expect(id?.primary).toBe(true);
    expect(id?.getSQLType()).toBe("uuid");

    const generated = id?.defaultFn?.() as string;

    // Version nibble 7 (ADR-0006): time-ordered, so inserts append to the
    // index instead of scattering it. `crypto.randomUUID` would be v4 here.
    expect(generated).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("orders generated ids monotonically, which is the point of v7", () => {
    const id = columnsOf(staff).get("id");
    const generated = Array.from(
      { length: 20 },
      () => id?.defaultFn?.() as string,
    );

    expect([...generated].sort()).toEqual(generated);
  });
});
