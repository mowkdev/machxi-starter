/* eslint-disable no-restricted-properties -- the one module allowed to read process.env (ADR-0004). */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";

import { defaultArgon2Params, type Argon2Params } from "@repo/crypto";

/**
 * The only place in `@repo/db` that reads `process.env` (ADR-0004).
 *
 * The API has `core/config` for this; the package's CLI entry points —
 * `src/migrate.ts`, `seeds/run.ts`, `seeds/reset.ts` and `drizzle.config.ts` —
 * have this. The library surface takes its connection string as an argument,
 * so `import '@repo/db'` never touches the environment and never loads dotenv,
 * which is what keeps dotenv out of the API's production bundle.
 *
 * ADR-0004 permits `drizzle.config.ts` and the seed runner to read the
 * environment directly; funnelling all four through one module is stricter
 * than that and gives the "never print credentials" rule (ADR-0008
 * §Environment guardrails) a single implementation.
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

/** The super-admin credentials (ADR-0008). Absent means "skip the seeder". */
export const readSuperAdminCredentials = (): {
  email: string | undefined;
  password: string | undefined;
} => ({
  email: read("SEED_SUPER_ADMIN_EMAIL"),
  password: read("SEED_SUPER_ADMIN_PASSWORD"),
});

/** Absolute path of the committed migrations folder. */
export const migrationsFolder = resolve(packageRoot, "migrations");
