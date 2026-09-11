import { and, eq, isNull } from "drizzle-orm";

import { federatedIdentities, users } from "../../src/index.js";
import type { Seeder } from "../types.js";
import { DEV_FEDERATED_IDENTITY } from "./fixtures.js";

/**
 * One Google identity on the first `--dev` customer (ADR-0072 §1), so the
 * surfaces that list and remove an account's ways in have a row on a fresh
 * clone. The subject is synthetic — see the fixture's own note for why that is
 * a safety property and not only a convenience.
 *
 * Idempotent on the table's own `(provider, subject)` constraint: a second run
 * conflicts and inserts nothing, and a clone whose customer already holds a
 * *different* Google identity keeps it — the `(user_id, provider)` constraint
 * refuses the fixture, and `onConflictDoNothing` with no target absorbs either
 * refusal rather than overwriting a link somebody made by hand.
 */
export const devFederatedIdentitiesSeeder: Seeder = {
  name: "104-dev-federated-identities",
  run: async ({ db, log }) => {
    const owner = await db.query.users.findFirst({
      where: and(
        eq(users.email, DEV_FEDERATED_IDENTITY.userEmail),
        isNull(users.deletedAt),
      ),
      columns: { id: true },
    });

    if (owner === undefined) {
      // `102-dev-users` runs first and creates it; skipping rather than
      // throwing keeps `--dev` re-runnable against a database somebody has
      // been deleting rows in by hand, as `103` does.
      log(
        `${DEV_FEDERATED_IDENTITY.userEmail} is absent; skipping the fixture identity`,
      );
      return;
    }

    await db
      .insert(federatedIdentities)
      .values({
        userId: owner.id,
        provider: DEV_FEDERATED_IDENTITY.provider,
        subject: DEV_FEDERATED_IDENTITY.subject,
        email: DEV_FEDERATED_IDENTITY.email,
      })
      .onConflictDoNothing();

    log(
      `${DEV_FEDERATED_IDENTITY.provider} identity present for ${DEV_FEDERATED_IDENTITY.userEmail} (synthetic subject)`,
    );
  },
};
