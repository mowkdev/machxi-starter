/* eslint-disable no-restricted-properties -- the one module allowed to read process.env (ADR-0004). */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The only place in `@repo/db` that reads `process.env` (ADR-0004).
 *
 * The API has `core/config` for this; the package's CLI entry points —
 * `src/migrate.ts`, `src/reset.ts`, `seeds/run.ts` and `drizzle.config.ts` —
 * have this. The library surface takes its connection string as an argument,
 * so `import '@repo/db'` never touches the environment and never reads a file.
 *
 * The file is read with Node's own `process.loadEnvFile`, not a package
 * (`D21.4`). `dist/migrate.js` and `dist/prune-sessions.js` inline their whole
 * closure into the API image's `dist/` (`tsdown.config.ts`), so a loader
 * package imported here ships in production however the library surface is
 * kept — which is what ADR-0004's "No `dotenv` in production builds"
 * forbids. A built-in ships nothing.
 *
 * ADR-0004 names this module as the one reader outside `core/config`: it gives
 * the "print the target, never the credentials" rule (ADR-0008 §Environment
 * guardrails) a single implementation, and it is where the constraints the
 * API's schema declares are enforced for variables the API never sees.
 */

const moduleDir = dirname(fileURLToPath(import.meta.url));

/**
 * The directory holding `migrations/`.
 *
 * Found by walking up from this module rather than by counting `../` from it,
 * because since `D14.3` this file has **two** layouts to answer for (ADR-0059
 * §5): the source tree, where it sits at `packages/db/src/tooling/`, and the
 * bundled `dist/migrate.js`, where it has been inlined into a file at
 * `<root>/dist/` — inside the API image, `/app/dist/migrate.js` beside
 * `/app/migrations`. A fixed `../..` is correct in exactly one of them, and
 * the failure in the other is a migrate job that reports "up to date" against
 * a folder that does not exist.
 *
 * The journal file, not the directory name, is what the walk matches: it is
 * the artefact Drizzle actually reads, so a `migrations/` belonging to
 * something else cannot be mistaken for this one.
 */
const findPackageRoot = (): string => {
  let dir = moduleDir;

  for (;;) {
    if (existsSync(join(dir, "migrations", "meta", "_journal.json"))) {
      return dir;
    }

    const parent = dirname(dir);

    if (parent === dir) {
      // The source layout's answer, so a checkout with no generated journal
      // yet still points `drizzle-kit generate` at the right folder.
      return resolve(moduleDir, "../..");
    }

    dir = parent;
  }
};

const packageRoot = findPackageRoot();

/**
 * Where `loadEnvFile` looks for the root `.env`.
 *
 * In the source tree that is the repository root. Inside the API image, where
 * `packageRoot` is `/app`, it resolves to `/` and there is no file there — a
 * deployed environment injects its variables and loading is skipped, which is
 * the case `loadEnvFile` was written for. It is additive either way: Node's
 * loader does not override, so an injected value always wins.
 */
const repoRoot = resolve(packageRoot, "../..");

let loaded = false;

/**
 * Loads the **root** `.env` — the same file Docker Compose reads (ADR-0004),
 * so the credentials exist once. Values already present in the environment
 * win: `process.loadEnvFile` does not override, which is what makes
 * `DATABASE_URL=… pnpm db:migrate` and a deployed environment with no `.env` at
 * all both work. The existence check is what "no file" needs: Node's loader
 * throws on a missing file where a package would have returned quietly.
 *
 * `path` is the seam `env.test.ts` uses to prove the precedence against a
 * file of its own; every caller in the package takes the default.
 */
export const loadEnvFile = (path = resolve(repoRoot, ".env")): void => {
  if (loaded) {
    return;
  }

  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
  loaded = true;
};

const read = (key: string): string | undefined => {
  loadEnvFile();

  const value = process.env[key]?.trim();

  return value === "" ? undefined : value;
};

const required = (key: string): string => {
  const value = read(key);

  if (value === undefined) {
    throw new Error(
      `${key} is not set. Copy .env.example to .env at the repository root (ADR-0004).`,
    );
  }

  return value;
};

/**
 * The **application** role's connection (ADR-0061 §1).
 *
 * What the API connects as, and what a script that only reads and writes rows
 * — `db:sessions:prune` — connects as. It holds `SELECT`, `INSERT`, `UPDATE`
 * and `DELETE` on the tables it needs and nothing else: no DDL, no ownership,
 * and no `UPDATE` or `DELETE` on `audit_events`.
 */
export const readDatabaseUrl = (): string => required("DATABASE_URL");

/**
 * The **owner** role's connection (ADR-0061 §1).
 *
 * What runs DDL: `db:migrate`, `db:seed`, `db:reset`, `drizzle-kit` and the
 * test harness's `migrateFreshDatabase`.
 *
 * **Required, with no fallback to `DATABASE_URL`.** A fallback is how a
 * deployment ends up migrating as its application role and never finding out —
 * the migration fails on a `CREATE TABLE` it has no privilege for, or worse,
 * succeeds because somebody quietly gave the application role DDL back.
 */
export const readOwnerDatabaseUrl = (): string =>
  required("DATABASE_URL_OWNER");

/**
 * The integration-test database (ADR-0021). Tooling-only — deliberately absent
 * from the API's zod schema (ADR-0004), because the API must never be able to
 * connect to it.
 *
 * From step 7 on, `apps/api/.env.test` is the file the API's `globalSetup`
 * follows; the root value read here is what lets this package's own
 * integration tests run before that file exists.
 */
export const readTestDatabaseUrl = (): string => required("DATABASE_URL_TEST");

/**
 * The integration-test database as the **owner** (ADR-0061 §1).
 *
 * The harness migrates and truncates through this one and runs the suite
 * through {@link readTestDatabaseUrl}, so every query a test makes carries
 * exactly the privileges production has — which is the only way a missing
 * grant is ever found by a machine rather than by a deployment.
 */
export const readTestOwnerDatabaseUrl = (): string =>
  required("DATABASE_URL_TEST_OWNER");

/**
 * `NODE_ENV`, with an unset value read as `development` (ADR-0075 §4).
 *
 * This deliberately differs from the API, whose config schema requires the
 * variable and has no default (ADR-0004). These scripts run from a developer's
 * bare shell, and the image that runs them in production sets
 * `NODE_ENV=production` itself (`apps/api/Dockerfile`). A production database
 * targeted from a shell that forgot the variable is treated as development:
 * the printed target line is the warning, and nothing refuses it.
 */
export const readNodeEnv = (): string => read("NODE_ENV") ?? "development";

/**
 * Guards the destructive and fixture-creating paths (ADR-0008 §Environment
 * guardrails): `db:reset` and `--dev` seeding refuse to run in production.
 */
export const isProduction = (): boolean => readNodeEnv() === "production";

/**
 * An optional integer variable, defaulted. Exported for `argon2.ts`, which is
 * the one reader that had to move out of this module (see the note there).
 */
export const readInt = (key: string, fallback: number): number => {
  const value = read(key);

  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new Error(`${key} must be an integer, got ${JSON.stringify(value)}.`);
  }

  return parsed;
};

/** The shortest password ADR-0018 accepts anywhere, mirrored from ADR-0004's `min(12)`. */
const minSuperAdminPasswordLength = 12;

/**
 * The `SEED_SUPER_ADMIN_PASSWORD` values committed to this repository, in
 * `.env.example` and `apps/api/.env.test`.
 *
 * Mirrored from `apps/api/src/core/config/schema.ts`
 * (`KNOWN_PUBLIC_SEED_PASSWORDS`), which cannot be imported here —
 * `@repo/db` must not depend on the API (ADR-0002). It is duplicated rather
 * than dropped because **this** is the path that matters: the seed runner is a
 * CLI and never passes through `core/config`, so a production `pnpm db:setup`
 * assembled by copying a committed env file would otherwise create a
 * `super_admin` whose password is public. A test in each package reads both
 * files and asserts its own list covers them.
 */
const knownPublicSeedPasswords: readonly string[] = [
  "ChangeMe123!local",
  "TestSuperAdmin!123",
];

/**
 * The super-admin credentials (ADR-0008). Absent means "skip the seeder";
 * **present but invalid is an error**, not a silently weak account.
 *
 * ADR-0004 constrains these two variables (`z.string().email()`,
 * `z.string().min(12)`), but the seed runner never passes through
 * `core/config` — so the constraint has to be enforced here or not at all.
 * Without it a four-character password seeds happily and then logs in fine,
 * because the length policy is only applied on register and change-password.
 * Same argument that put the argon2 floor inside `@repo/crypto`: check where
 * the value is read, not where one consumer happens to look.
 */
export const readSuperAdminCredentials = (): {
  email: string | undefined;
  password: string | undefined;
} => {
  const email = read("SEED_SUPER_ADMIN_EMAIL");
  const password = read("SEED_SUPER_ADMIN_PASSWORD");

  // Deliberately not a full RFC 5322 parse — that belongs to the zod schema in
  // `@repo/contracts`, which this package may not import for a CLI check. This
  // catches the realistic mistake: a name or a shell-mangled value.
  if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(
      "SEED_SUPER_ADMIN_EMAIL is not an email address (ADR-0004). The account it would create can never sign in.",
    );
  }

  if (password !== undefined && password.length < minSuperAdminPasswordLength) {
    throw new Error(
      `SEED_SUPER_ADMIN_PASSWORD must be at least ${String(minSuperAdminPasswordLength)} characters (ADR-0004); it is ${String(password.length)}.`,
    );
  }

  // The account this seeds holds `super_admin`, which bypasses every staff role
  // check (ADR-0019). Length cannot distinguish a committed dummy from a real
  // credential; enumeration can (ADR-0020 §Known-public secrets).
  if (
    password !== undefined &&
    isProduction() &&
    knownPublicSeedPasswords.includes(password)
  ) {
    throw new Error(
      "SEED_SUPER_ADMIN_PASSWORD is a value committed in this repository and must not seed a production super admin (ADR-0020).",
    );
  }

  return { email, password };
};

/** Absolute path of the committed migrations folder. */
export const migrationsFolder = resolve(packageRoot, "migrations");
