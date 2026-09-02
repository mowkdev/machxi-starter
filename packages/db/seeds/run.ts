import { createArgon2Hasher } from "@repo/crypto";

import { createDb } from "../src/index.js";
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
export const devSeeders: readonly Seeder[] = [devStaffSeeder, devUsersSeeder];

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
 */
export const runSeeders = async (
  seeders: readonly Seeder[],
  ctx: Omit<SeedContext, "log">,
): Promise<void> => {
  for (const seeder of seeders) {
    // Sequential on purpose: seeders are ordered because later ones may depend
    // on earlier ones, and `Promise.all` would throw that away for a saving
    // measured in milliseconds.
    await seeder.run({
      ...ctx,
      log: (message) => {
        writeLine(`  ${seeder.name}: ${message}`);
      },
    });
  }
};

const main = async (): Promise<void> => {
  const args = parseSeedArgs(process.argv.slice(2));
  const nodeEnv = readNodeEnv();
  const seeders = selectSeeders(args, nodeEnv);
  // The owner's connection (ADR-0061 §1). Seeding writes rows, which the
  // application role could do — but the seeders are tooling, they run beside
  // `db:migrate` in `db:setup`, and a second connection string in that one
  // command is a second thing to get wrong. One rule: `packages/db`'s CLI
  // entry points connect as the owner.
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
