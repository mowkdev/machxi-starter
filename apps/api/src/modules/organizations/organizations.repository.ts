import type { OrganizationKind } from "@repo/contracts";
import { organizations, type DbExecutor } from "@repo/db";
import { and, eq, isNull } from "drizzle-orm";

/**
 * Every query against `organizations` (ADR-0009).
 *
 * SQL lives here and nowhere above it — the ESLint rule in
 * `@repo/eslint-config/api` is what enforces that, and this table has been in
 * its list since `D15.1`.
 *
 * `organizations` is **not** tenant-owned: it is the tenant (ADR-0067 §1), so
 * nothing here takes an organization id as a scope. Its two dependants —
 * `memberships.repository.ts` and `invitations.repository.ts` — do, and take
 * it as a required first parameter.
 *
 * Every function takes an optional `tx` so a service can compose several
 * repositories inside one transaction (ADR-0006); outside one it is the client.
 */

/** An `organizations` row, whole. */
export interface OrganizationRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly kind: OrganizationKind;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** The soft-delete marker (ADR-0067 §3), the `users` semantics. */
  readonly deletedAt: Date | null;
}

/** What every path that creates an organization inserts. */
export interface NewOrganizationInput {
  readonly slug: string;
  readonly name: string;
  readonly kind: OrganizationKind;
  readonly createdBy: string;
}

const recordColumns = {
  id: true,
  slug: true,
  name: true,
  kind: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

const returnedColumns = {
  id: organizations.id,
  slug: organizations.slug,
  name: organizations.name,
  kind: organizations.kind,
  createdBy: organizations.createdBy,
  createdAt: organizations.createdAt,
  updatedAt: organizations.updatedAt,
  deletedAt: organizations.deletedAt,
} as const;

export const createOrganizationsRepository = (db: DbExecutor) =>
  ({
    /**
     * A **live** organization by id.
     *
     * Soft-deleted rows are excluded here rather than at each call site,
     * because a deleted organization is not a tenant any more: its memberships
     * and invitations survive the soft delete — nothing cascades on it — so
     * every read that treats one as live grants access inside a deleted tenant
     * (`D15.1`'s note to this step).
     */
    findById: async (
      id: string,
      tx: DbExecutor = db,
    ): Promise<OrganizationRecord | undefined> =>
      tx.query.organizations.findFirst({
        columns: recordColumns,
        where: and(eq(organizations.id, id), isNull(organizations.deletedAt)),
      }),

    /**
     * A **live** organization by slug — the customer app's URLs (ADR-0067 §6).
     *
     * Live only, and `organizations_slug_active_unique` is why it can be: the
     * unique index is partial, so a slug identifies at most one live row and
     * any number of deleted ones.
     *
     * **It carries no membership scope.** `requireMembership` exists so that
     * an organization id is not an existence oracle (ADR-0067 §4), and a slug
     * is one just as much — so an endpoint that took a slug and answered from
     * this alone would undo the guard. ADR-0067 §6 resolves the slug in the
     * client against `GET /user/orgs`, which is why no route takes one; any
     * caller added here is staff-side or joins the memberships table itself.
     */
    findBySlug: async (
      slug: string,
      tx: DbExecutor = db,
    ): Promise<OrganizationRecord | undefined> =>
      tx.query.organizations.findFirst({
        columns: recordColumns,
        where: and(
          eq(organizations.slug, slug),
          isNull(organizations.deletedAt),
        ),
      }),

    /** The caller's live `personal` organization (ADR-0067 §2). */
    findPersonalFor: async (
      userId: string,
      tx: DbExecutor = db,
    ): Promise<OrganizationRecord | undefined> =>
      tx.query.organizations.findFirst({
        columns: recordColumns,
        where: and(
          eq(organizations.createdBy, userId),
          eq(organizations.kind, "personal"),
          isNull(organizations.deletedAt),
        ),
      }),

    /**
     * Inserts an organization.
     *
     * @returns the row, or `undefined` when a **live** organization already
     *   holds the slug. The conflict target is named with its predicate,
     *   because `organizations_slug_active_unique` is partial: an insert naming
     *   a constraint that does not exist matches no index and escapes as a
     *   `500` rather than as the `CONFLICT` the caller is owed (ADR-0067 §2).
     */
    create: async (
      input: NewOrganizationInput,
      tx: DbExecutor = db,
    ): Promise<OrganizationRecord | undefined> => {
      const [created] = await tx
        .insert(organizations)
        .values(input)
        .onConflictDoNothing({
          target: organizations.slug,
          where: isNull(organizations.deletedAt),
        })
        .returning(returnedColumns);

      return created;
    },

    /**
     * Stamps `deleted_at` on a live row.
     *
     * @returns `false` when no **live** organization has that id, which is the
     *   one thing that sees a concurrent delete: a caller that read the row
     *   outside this transaction cannot, and would otherwise report success for
     *   a request that changed nothing (the `users.softDelete` reading,
     *   ADR-0028).
     */
    softDelete: async (
      id: string,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<boolean> => {
      const updated = await tx
        .update(organizations)
        .set({ deletedAt: at, updatedAt: at })
        .where(and(eq(organizations.id, id), isNull(organizations.deletedAt)))
        .returning({ id: organizations.id });

      return updated.length > 0;
    },
  }) as const;

export type OrganizationsRepository = ReturnType<
  typeof createOrganizationsRepository
>;
