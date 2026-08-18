/* eslint-disable no-restricted-properties -- the one module allowed to read process.env (ADR-0004). */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";

import { defaultArgon2Params, type Argon2Params } from "@repo/crypto";

/**
 * The only place in `@repo/db` that reads `process.env` (ADR-0004).
 *
 * The API has `core/config` for this; the package's CLI entry points —
 * `src/migrate.ts`, `src/reset.ts`, `seeds/run.ts` and `drizzle.config.ts` —
 * have this. The library surface takes its connection string as an argument,
 * so `import '@repo/db'` never touches the environment and never loads dotenv,
 * which is what keeps dotenv out of the API's production bundle.
 *
 * ADR-0004 names this module as the one reader outside `core/config`: it gives
 * the "print the target, never the credentials" rule (ADR-0008 §Environment
 * guardrails) a single implementation, and it is where the constraints the
 * API's schema declares are enforced for variables the API never sees.
 */

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolve(packageRoot, "../..");

let loaded = false;

/**
 * Loads the **root** `.env` — the same file Docker Compose reads (ADR-0004),
 * so the credentials exist once. Values already present in the environment
 * win: dotenv does not override, which is what makes `DATABASE_URL=… pnpm
 * db:migrate` and a deployed environment with no `.env` at all both work.
 */
export const loadEnvFile = (): void => {
  if (loaded) {
    return;
  }

  loadDotenv({ path: resolve(repoRoot, ".env"), quiet: true });
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

/** Where migrations, seeds and `drizzle-kit` point by default. */
export const readDatabaseUrl = (): string => required("DATABASE_URL");

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

/** `NODE_ENV`, defaulted the same way the API's config schema defaults it. */
export const readNodeEnv = (): string => read("NODE_ENV") ?? "development";

/**
 * Guards the destructive and fixture-creating paths (ADR-0008 §Environment
 * guardrails): `db:reset` and `--dev` seeding refuse to run in production.
 */
export const isProduction = (): boolean => readNodeEnv() === "production";

const readInt = (key: string, fallback: number): number => {
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

/**
 * The `ARGON2_*` variables, defaulted from `@repo/crypto` so the seeder hashes
 * with exactly the parameters the API verifies against (ADR-0008). Values
 * below the OWASP floor are rejected by `createArgon2Hasher`, not here — one
 * check, in the package that owns the algorithm.
 */
export const readArgon2Params = (): Argon2Params => ({
  memoryKib: readInt("ARGON2_MEMORY_KIB", defaultArgon2Params.memoryKib),
  timeCost: readInt("ARGON2_TIME_COST", defaultArgon2Params.timeCost),
  parallelism: readInt("ARGON2_PARALLELISM", defaultArgon2Params.parallelism),
});

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
