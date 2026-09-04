import { isNotNull, isNull, relations, sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  citext,
  organizationKindEnum,
  organizationRoleEnum,
  primaryId,
  timestamps,
} from "./_shared.js";
import { users } from "./users.js";

/**
 * Organizations — the tenant (ADR-0067 §1, §2).
 *
 * One database, one schema, and a tenant column on every table an
 * organization owns. This table is the thing those columns point at, so it is
 * **not itself tenant-owned**: it declares the ordinary `(column, id)` pairs
 * of ADR-0060 §3 rather than the tenant-led composites its dependants do.
 *
 * Every user has at least one of these from the moment their account exists —
 * a `personal` organization created in the same transaction as the account
 * (ADR-0067 §2) — which is why no query anywhere has a "no organization"
 * branch.
 */
export const organizations = pgTable(
  "organizations",
  {
    id: primaryId(),
    /**
     * The URL name, on both the API's admin surface and the customer app's
     * `/orgs/$orgSlug` routes (ADR-0067 §6).
     *
     * `citext` for the reason `users.email` is: uniqueness must not depend on
     * how somebody typed it, and no query should need a `lower()`. Unique
     * among **live** rows only — the partial index below, the `users`
     * precedent (ADR-0028) — so deleting an organization releases its name.
     */
    slug: citext().notNull(),
    name: text().notNull(),
    kind: organizationKindEnum().notNull(),
    /**
     * Who created it: the account itself for a `personal` organization, the
     * calling user for a `team` one.
     *
     * `restrict` rather than `cascade`: a user is soft-deleted (ADR-0028), so
     * this reference is never actually followed by a delete, and if one day it
     * were, taking an organization's whole history with the account that
     * happened to open it would be the wrong default.
     */
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    ...timestamps(),
    /**
     * Soft delete (ADR-0067 §3), the `users` semantics. A `personal`
     * organization is never deleted on its own — it is stamped here inside the
     * user's own deletion transaction, and refuses `DELETE` otherwise
     * (ADR-0067 §2). That refusal is the service's; nothing in the schema can
     * express "unless the owning user is going too".
     */
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    /**
     * One **live** organization per slug (the `users_email_active_unique`
     * shape, ADR-0028). Partial, so a deleted organization does not reserve
     * its name forever, and it is the conflict target a create must name in
     * `onConflictDoNothing` — an insert naming a constraint that does not
     * exist matches no index and escapes as a `500` instead of a `CONFLICT`.
     */
    uniqueIndex("organizations_slug_active_unique")
      .on(table.slug)
      .where(isNull(table.deletedAt)),
    /*
     * One btree index per sortable column, composite with `id` (ADR-0060 §3):
     * `applyListQuery` appends `asc(id)` to every `ORDER BY`, so `(column,
     * id)` is the pagination key rather than a prefix of it.
     *
     * The bare form and not the tenant-led one, because this table is the
     * tenant: ADR-0067 §1 drops the bare pairs on tables that *carry* an
     * `organization_id`, and says in the same clause that `organizations`
     * keeps them.
     */
    index("organizations_created_at_idx").on(table.createdAt, table.id),
    index("organizations_updated_at_idx").on(table.updatedAt, table.id),
    /*
     * `organizations_slug_active_unique` above is partial, so — exactly as
     * with `users.email` — it cannot order a list that includes deleted rows,
     * which is what `filter[deletedAt][null]=false` asks for.
     */
    index("organizations_slug_idx").on(table.slug, table.id),
    index("organizations_name_idx").on(table.name, table.id),
    index("organizations_kind_idx").on(table.kind, table.id),
    index("organizations_created_by_idx").on(table.createdBy, table.id),
    /*
     * Filterable by presence only, and only one presence is worth indexing:
     * the column is null on every live organization (ADR-0060 §3).
     */
    index("organizations_deleted_at_idx")
      .on(table.deletedAt)
      .where(isNotNull(table.deletedAt)),
    /*
     * What `q` searches (ADR-0060 §3): `ilike '%term%'` reads no btree index,
     * so each searched column gets a `pg_trgm` GIN one. `slug` is `citext`,
     * which is binary-coercible to `text`, so `gin_trgm_ops` applies — the
     * `users.email` reading.
     */
    index("organizations_name_trgm_idx").using(
      "gin",
      table.name.op("gin_trgm_ops"),
    ),
    index("organizations_slug_trgm_idx").using(
      "gin",
      table.slug.op("gin_trgm_ops"),
    ),
  ],
);

/**
 * Who belongs to an organization, and as what (ADR-0067 §2).
 *
 * Many-to-many from the first day, so nothing migrates when a user's second
 * organization appears. The primary key is the pair rather than a surrogate
 * id: a membership *is* the pair, and a second row for the same pair is not a
 * second membership but a bug.
 *
 * Tenant-owned, so its indexes are led by `organization_id` and there are no
 * bare pairs beside them (ADR-0067 §1). The pagination tiebreaker on this
 * table is `user_id`, there being no `id` column to append.
 */
export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: organizationRoleEnum().notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    /*
     * The one read scoped by the **principal** rather than by a tenant
     * (ADR-0067 §5): "the organizations this user belongs to", which is the
     * switcher's query and the first thing `requireMembership` cannot use
     * because it does not yet know the organization.
     */
    index("organization_memberships_user_id_idx").on(table.userId),
    /*
     * Tenant-led, one per order the members list offers (ADR-0067 §1). The
     * primary key already serves an order by `user_id` within an organization;
     * these two serve the other two.
     */
    index("organization_memberships_organization_id_created_at_idx").on(
      table.organizationId,
      table.createdAt,
      table.userId,
    ),
    index("organization_memberships_organization_id_role_idx").on(
      table.organizationId,
      table.role,
      table.userId,
    ),
  ],
);

/**
 * A pending invitation to join an organization (ADR-0067 §2).
 *
 * It names an **address, not an account**, and that is the whole reason the
 * flow is enumeration-safe (ADR-0020 §Enumeration): creating one never looks a
 * user up, so it cannot answer differently for an address that has one.
 *
 * The row's state is its timestamps, not a column: `pending` until one of
 * `accepted_at`, `declined_at` and `revoked_at` is stamped, and `expired` once
 * the clock passes `expires_at` — which no column can hold, because nothing
 * writes a row when a clock moves and D15 ships no sweeper by decision.
 * `INVITATION_STATUSES` in `@repo/contracts` is the derived wire form.
 */
export const organizationInvitations = pgTable(
  "organization_invitations",
  {
    id: primaryId(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** `citext`, so an invitation matches the invitee's address however either was typed. */
    email: citext().notNull(),
    role: organizationRoleEnum().notNull(),
    /**
     * The member who sent it. `restrict`, like `organizations.created_by`: the
     * fact that this person invited this address outlives their membership.
     */
    invitedBy: uuid()
      .notNull()
      .references(() => users.id),
    /**
     * SHA-256 of the invitation's opaque single-use token, base64url — the
     * `sessions.refresh_token_hash` and `impersonation_handoffs.token_hash`
     * shape (ADR-0018 as carried by ADR-0057 §2), so a database read never
     * yields a usable credential. The mint is `randomToken()` from
     * `@repo/crypto` at its default 32 bytes, which ADR-0067 §2 fixes rather
     * than leaves to the create path: this is the one credential here whose
     * lookup is scoped by nothing else. It is never mapped onto the wire.
     *
     * **Nothing reads this column in D15** (ADR-0067 §2, amended 2026-09-04).
     * Acceptance matches by address, because no deliverable here can put a
     * token in front of an invitee: D15 sends no mail. The column exists now
     * because the row it belongs to is created by `D15.3` and the day the mail
     * deliverable requires the token must not be the day a table with a live
     * accept path takes a migration.
     *
     * `not null`: every invitation is created with one, so the accept path
     * never grows a "this row has no token" branch — the reasoning ADR-0067
     * gives for refusing a nullable `organization_id`, applied to a
     * credential.
     *
     * **Single use needs no column of its own.** An invitation ends exactly
     * once, and the timestamps beside this already say so; the atomic consume
     * is `impersonation_handoffs`' shape over the terminal stamps this table
     * already carries, guarded on all four and on the organization still being
     * live (ADR-0067 §2 writes it out in full):
     *
     * ```sql
     * update organization_invitations i set accepted_at = now()
     *  where i.token_hash = $1 and i.accepted_at is null
     *    and i.declined_at is null and i.revoked_at is null
     *    and i.expires_at > now()
     *    and exists (select 1 from organizations o
     *                 where o.id = i.organization_id and o.deleted_at is null)
     * returning i.*
     * ```
     *
     * The `exists` clause is load-bearing: `organization_id` cascades on a
     * **hard** delete only, so these rows outlive their organization's soft
     * delete, and an accept without it grants membership in a deleted tenant.
     * A `token_used_at` beside the stamps would be a second source of truth
     * for "this invitation is over" — the bug the missing `status` column was
     * refused for.
     *
     * Unique, and named explicitly for the reason `sessions` names its own: an
     * unnamed `.unique()` takes the TS property name and would put one
     * camelCase identifier in an otherwise snake_case database. It is a
     * credential constraint and not a list index, so ADR-0067 §1's "no bare
     * pairs on a tenant-owned table" does not reach it — nothing orders or
     * paginates by a hash, and this column enters no `sortable`, `filterable`
     * or searchable allow-list, whatever `indexCoverage` reports about it.
     */
    tokenHash: text()
      .notNull()
      .unique("organization_invitations_token_hash_unique"),
    /** Bounded by `ORGANIZATION_INVITATION_TTL` at creation (ADR-0067 §2). */
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    declinedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    /*
     * `owner` is not an invitable role — ownership is granted by an owner to
     * an existing member (ADR-0067 §2). Written as a check rather than as a
     * second Postgres enum over two of the three labels: one type, one tuple
     * in `@repo/contracts`, and the narrowing said once here and once in the
     * zod schema that accepts the request.
     */
    check(
      "organization_invitations_role_not_owner",
      sql`${table.role} <> 'owner'`,
    ),
    /*
     * Tenant-led, one per order the pending list offers (ADR-0067 §1), and no
     * bare pairs beside them.
     */
    index("organization_invitations_organization_id_created_at_idx").on(
      table.organizationId,
      table.createdAt,
      table.id,
    ),
    index("organization_invitations_organization_id_updated_at_idx").on(
      table.organizationId,
      table.updatedAt,
      table.id,
    ),
    index("organization_invitations_organization_id_email_idx").on(
      table.organizationId,
      table.email,
      table.id,
    ),
    /*
     * The second principal-scoped read (ADR-0067 §5): `GET /user/invitations`
     * is about the caller's own address and knows no organization, so this one
     * index is led by `email` rather than by the tenant.
     */
    index("organization_invitations_email_idx").on(table.email, table.id),
    /* What `q` searches on the pending list (ADR-0060 §3). */
    index("organization_invitations_email_trgm_idx").using(
      "gin",
      table.email.op("gin_trgm_ops"),
    ),
  ],
);

export const organizationsRelations = relations(
  organizations,
  ({ many, one }) => ({
    memberships: many(organizationMemberships),
    invitations: many(organizationInvitations),
    creator: one(users, {
      fields: [organizations.createdBy],
      references: [users.id],
    }),
  }),
);

export const organizationMembershipsRelations = relations(
  organizationMemberships,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [organizationMemberships.organizationId],
      references: [organizations.id],
    }),
    user: one(users, {
      fields: [organizationMemberships.userId],
      references: [users.id],
    }),
  }),
);

export const organizationInvitationsRelations = relations(
  organizationInvitations,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [organizationInvitations.organizationId],
      references: [organizations.id],
    }),
    inviter: one(users, {
      fields: [organizationInvitations.invitedBy],
      references: [users.id],
    }),
  }),
);
