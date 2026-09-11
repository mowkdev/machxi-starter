import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import {
  citext,
  federatedProviderEnum,
  primaryId,
  timestamps,
} from "./_shared.js";
import { users } from "./users.js";

/**
 * A user's external identities (ADR-0072 §1) — the delta on ADR-0017 that
 * gives the nullable `users.password_hash` the path it was reserved for.
 *
 * One row says "this provider's account `subject` is a way into this user".
 * A user may hold no password and one or more of these, or a password and
 * none, or both; which ways in exist is read from this table and the hash
 * together, never from a flag on `users`.
 *
 * **Users only.** Staff get no federated login (ADR-0072 §5), so there is no
 * `staff_federated_identities` and no principal discriminator: the per-
 * population rule (ADR-0045) is satisfied by there being one population here,
 * and the foreign key below is a real one.
 */
export const federatedIdentities = pgTable(
  "federated_identities",
  {
    id: primaryId(),
    /**
     * The account this identity signs into.
     *
     * A real foreign key, which the credential tables cannot have and this one
     * can: it names one population. `cascade` for the reason the settings
     * tables give theirs — a hard delete, which `users` does not have today
     * (ADR-0028 soft-deletes), would take the row with it rather than leave an
     * identity pointing at nothing.
     */
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: federatedProviderEnum().notNull(),
    /**
     * The provider's stable subject — the ID token's `sub` (ADR-0072 §1).
     *
     * **The lookup key, and the only one.** A sign-in resolves by
     * (`provider`, `subject`) first, whatever address either side carries
     * today, which is what lets a person who changed their address here
     * (ADR-0071 §6) or at the provider still sign in. `text` rather than a
     * number because the claim is a string in every provider's contract, and
     * Google's is a decimal string wider than a `bigint` promises.
     */
    subject: text().notNull(),
    /**
     * The address the provider reported when this row was written —
     * **informational, never a lookup key after the link** (ADR-0072 §1).
     *
     * Nullable because a provider need not report one, and nothing reads it to
     * decide anything: it exists so the account's owner can tell which of
     * their Google accounts is linked. `citext` like every other address
     * column in the schema, so the one place it is displayed beside the
     * account's own address does not disagree about case.
     */
    email: citext(),
    /** When the identity was attached to this user — by creation, by address, or by an explicit link. */
    linkedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** `null` until the first sign-in through this identity after the one that linked it. */
    lastLoginAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    /*
     * One provider account resolves to one user (ADR-0072 §1). This is the
     * sign-in's lookup and the reason a subject can never be linked twice:
     * a second link of the same subject is a unique violation rather than a
     * second way into somebody else's account.
     *
     * Named explicitly for the reason `account_tokens` names its constraint:
     * an unnamed one takes the TS property names and would put camelCase in a
     * snake_case database.
     */
    unique("federated_identities_provider_subject_unique").on(
      table.provider,
      table.subject,
    ),
    /*
     * One user holds at most one identity per provider (ADR-0072 §1), so
     * "unlink Google" names one row and "link Google" on an account that has
     * one is a refusal the database makes as well as the service.
     *
     * Led by `user_id`, which makes it the foreign key's index too — the
     * profile's "which ways in does this account have" reads it — so the table
     * needs no second index for the reference.
     */
    unique("federated_identities_user_id_provider_unique").on(
      table.userId,
      table.provider,
    ),
  ],
);

export const federatedIdentitiesRelations = relations(
  federatedIdentities,
  ({ one }) => ({
    user: one(users, {
      fields: [federatedIdentities.userId],
      references: [users.id],
    }),
  }),
);
