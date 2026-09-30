import { createArgon2Hasher } from "@repo/crypto";

import { createDb, type Db } from "../src/index.js";
import { isEntryPoint } from "../src/tooling/entrypoint.js";
import { readArgon2Params } from "../src/tooling/argon2.js";
import {
  readNodeEnv,
  readOwnerDatabaseUrl,
  readSuperAdminCredentials,
} from "../src/tooling/env.js";
import {
  describeTarget,
  writeErrorLine,
  writeLine,
} from "../src/tooling/report.js";
import { devStaffSeeder } from "./dev/101-dev-staff.js";
import { devUsersSeeder } from "./dev/102-dev-users.js";
import { devOrganizationsSeeder } from "./dev/103-dev-organizations.js";
import { devFederatedIdentitiesSeeder } from "./dev/104-dev-federated-identities.js";
import { superAdminSeeder } from "./seeders/001-super-admin.js";
import type { SeedContext, Seeder } from "./types.js";

/**
 * The seed runner (ADR-0008).
 *
 * Seeders are ordered by their filename prefix and listed explicitly rather
 * than discovered from the directory: an import glob would make "which seeders
 * ran" depend on what happens to be on disk, and the order — which is what
 * makes a later seeder able to rely on an earlier one — invisible.
 *
 *   pnpm db:seed              # baseline: the super admin
 *   pnpm db:seed -- --dev     # baseline + local fixtures
 */

/** Runs in every environment. */
export const baseSeeders: readonly Seeder[] = [superAdminSeeder];

/** `--dev` only; refused when `NODE_ENV=production`. */
export const devSeeders: readonly Seeder[] = [
  devStaffSeeder,
  devUsersSeeder,
  // After `102`, which creates the account this one makes an owner: the
  // filename prefix is the order, and the order is what lets a later seeder
  // rely on an earlier one.
  devOrganizationsSeeder,
  // After `102` for the same reason: the identity is linked to an account that
  // seeder creates (ADR-0072 §1).
  devFederatedIdentitiesSeeder,
];

export interface SeedArgs {
  readonly dev: boolean;
}

/** Parses the CLI flags. Exported so the guard below is unit-testable without spawning a process. */
export const parseSeedArgs = (argv: readonly string[]): SeedArgs => ({
  dev: argv.includes("--dev"),
});

/** Chooses the seeder list, and refuses fixtures in production (ADR-0008 §Environment guardrails). */
export const selectSeeders = (
  args: SeedArgs,
  nodeEnv: string,
): readonly Seeder[] => {
  if (!args.dev) {
    return baseSeeders;
  }

  if (nodeEnv === "production") {
    throw new Error(
      "db:seed --dev creates accounts with a committed password and refuses to run when NODE_ENV=production.",
    );
  }

  return [...baseSeeders, ...devSeeders];
};

/**
 * Runs the given seeders against an already-open database, in order, logging
 * each outcome. Exported so the integration suite exercises the real seed path
 * rather than a copy of it (ADR-0021).
 *
 * **Each seeder runs in a transaction of its own** (`D28.4`, `DB-09`). The dev
 * users seeder writes users, their roles, their personal organizations and the
 * memberships as four statements, and ADR-0067 §2 says every path that creates
 * a user creates the organization in the same transaction — the seed path was
 * the one that did not. One transaction per seeder rather than one for the run:
 * a seeder is the unit of "all or nothing", and a later seeder failing has no
 * reason to take back the super admin an earlier one created.
 *
 * **No tenant setting is placed** (ADR-0083 §1). The seeders write across
 * tenants — an organization and its members, in no request and under no
 * principal — and they may because they connect as the owner, which the
 * tenant-owned tables' policies do not bind. There is no setting that would
 * let the application role do the same, so `db` must be an owner connection.
 */
export const runSeeders = async (
  seeders: readonly Seeder[],
  ctx: Omit<SeedContext, "log" | "db"> & { readonly db: Db },
): Promise<void> => {
  for (const seeder of seeders) {
    // Sequential on purpose: seeders are ordered because later ones may depend
    // on earlier ones, and `Promise.all` would throw that away for a saving
    // measured in milliseconds.
    await ctx.db.transaction(async (tx) => {
      await seeder.run({
        ...ctx,
        db: tx,
        log: (message) => {
          writeLine(`  ${seeder.name}: ${message}`);
        },
      });
    });
  }
};

const main = async (): Promise<void> => {
  const args = parseSeedArgs(process.argv.slice(2));
  const nodeEnv = readNodeEnv();
  const seeders = selectSeeders(args, nodeEnv);
  // The owner's connection (ADR-0061 §1, ADR-0083 §1). The seeders write
  // across tenants, which the application role cannot — no setting widens
  // the tenant policies — and they are tooling that runs beside `db:migrate`
  // in `db:setup`. One rule: `packages/db`'s CLI entry points connect as the
  // owner.
  const url = readOwnerDatabaseUrl();

  writeLine(
    `db:seed → ${describeTarget(url)} (NODE_ENV=${nodeEnv}${args.dev ? ", --dev" : ""})`,
  );

  const client = createDb(url, {
    max: 1,
    idleTimeout: 5,
    applicationName: "machxi-seed",
  });
  const hasher = createArgon2Hasher(readArgon2Params());
  const { email, password } = readSuperAdminCredentials();

  try {
    await runSeeders(seeders, {
      db: client.db,
      hasher,
      env: {
        nodeEnv,
        superAdminEmail: email,
        superAdminPassword: password,
      },
    });

    writeLine("db:seed ✓ done");
  } finally {
    await client.close();
  }
};

if (isEntryPoint(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    // The message, not the stack: a connection error from postgres.js can
    // carry the connection string, and the stack adds nothing a developer
    // needs at this level.
    writeErrorLine(
      `db:seed ✗ ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
