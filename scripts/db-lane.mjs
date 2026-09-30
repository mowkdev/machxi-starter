#!/usr/bin/env node
// `pnpm db:lane` — the current branch's test database (ADR-0082 §3).
//
// Slugs the branch (`lane/D29` → `d29`, `spike/d29-rls` → `spike-d29-rls`),
// creates `machxi_<slug>_test` beside `machxi_test` with that database's owner
// and the grants `docker/local/postgres/init/01-test-db.sql` gives it, and
// prints the slug on stdout — so `export TEST_DB_LANE=$(pnpm --silent db:lane)`
// is the whole of giving a lane its database. Idempotent: a second run finds
// the database and re-applies the grants. Takes no argument, and refuses
// `main`, whose tier runs on `machxi_test` itself.
//
// The URLs come from the committed `packages/db/.env.test`, never from the
// shell or the root `.env`: the harness loads that file over the shell, so the
// database created here is on the host the harness will connect to.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const TEST_SUFFIX = "_test";

/** How many hex characters of the branch's hash end a truncated slug. */
const HASH_LENGTH = 6;

/** The longest name Postgres keeps; a longer one is truncated silently. */
export const MAX_DATABASE_NAME_BYTES = 63;

/**
 * The longest slug a lane of `testDatabase` can carry: whatever of the 63
 * bytes Postgres keeps the base and the joining underscore leave. Derived
 * from the base rather than fixed, so a fork whose product name is longer
 * than the starter's still gets a lane database for an ordinary branch — the
 * rename allows 32 characters — and the harness, which refuses only a name
 * past the 63 bytes, accepts every slug this caps (ADR-0082 §3; ADR-0084
 * §1, D36.1's review). A truncated slug ends in a hash, so the cap leaves
 * room for at least a character and the hash.
 */
export function slugCap(testDatabase) {
  const cap = MAX_DATABASE_NAME_BYTES - Buffer.byteLength(testDatabase) - 1;

  if (cap < HASH_LENGTH + 2) {
    throw new Error(
      `db:lane: the test database ${JSON.stringify(testDatabase)} leaves ${String(Math.max(cap, 0))} of the ${String(MAX_DATABASE_NAME_BYTES)} bytes Postgres keeps for a lane; shorten the product name (ADR-0082 §3).`,
    );
  }

  return cap;
}

/**
 * The lane's slug for a branch name: `lane/` dropped, lower-cased, every run
 * of anything but letters and digits one hyphen, trimmed. A slug longer than
 * the cap keeps its head and ends in a hash of the whole branch name, so two
 * branches that differ only past the cut — `…-v1` and `…-v2`, or a cloud
 * branch's random suffix — never share a database; a slug that fits carries
 * no hash, so `lane/D29` is `d29`. `cap` is `slugCap` of the base the lane
 * sits beside. `main` is refused — its test database is
 * `machxi_test` — and so are `lane/main`, which would slug to it, and no
 * branch at all.
 */
export function slugBranch(branch, cap) {
  const name = branch.trim();

  if (name === "") {
    throw new Error(
      "db:lane: no branch is checked out (a detached HEAD has no lane); check out the lane's branch first (ADR-0082 §3).",
    );
  }

  if (name === "main") {
    throw new Error(
      "db:lane: main has no lane database — its integration tier runs on machxi_test, with TEST_DB_LANE unset (ADR-0082 §3).",
    );
  }

  const full = name
    .replace(/^lane\//i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (full === "") {
    throw new Error(
      `db:lane: the branch ${JSON.stringify(name)} has no letter or digit to name a lane by (ADR-0082 §3).`,
    );
  }

  if (full === "main") {
    throw new Error(
      `db:lane: the branch ${JSON.stringify(name)} slugs to main, which has no lane database — its integration tier runs on machxi_test (ADR-0082 §3).`,
    );
  }

  if (full.length <= cap) return full;

  const hash = createHash("sha1")
    .update(name)
    .digest("hex")
    .slice(0, HASH_LENGTH);
  const head = full.slice(0, cap - HASH_LENGTH - 1).replace(/-+$/, "");

  return `${head}-${hash}`;
}

/** `machxi_test` → `machxi_<slug>_test`, the rule the harness applies. */
export function laneDatabaseName(testDatabase, slug) {
  if (!testDatabase.endsWith(TEST_SUFFIX)) {
    throw new Error(
      `db:lane: the test database ${JSON.stringify(testDatabase)} does not end in "${TEST_SUFFIX}" (ADR-0008).`,
    );
  }

  const name = `${testDatabase.slice(0, -TEST_SUFFIX.length)}_${slug}${TEST_SUFFIX}`;

  // Postgres would keep the first 63 bytes and create a database whose name
  // no longer ends in `_test` — debris the harness then refuses to use.
  if (Buffer.byteLength(name) > MAX_DATABASE_NAME_BYTES) {
    throw new Error(
      `db:lane: the lane database "${name}" is longer than the ${MAX_DATABASE_NAME_BYTES} bytes Postgres keeps (ADR-0082 §3).`,
    );
  }

  return name;
}

const databaseOf = (url) =>
  decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));

const roleOf = (url) => decodeURIComponent(new URL(url).username);

const withDatabase = (url, database) => {
  const parsed = new URL(url);

  parsed.pathname = `/${database}`;

  return parsed.toString();
};

/** A quoted identifier: a lane slug carries hyphens. */
const ident = (name) => `"${name.replaceAll('"', '""')}"`;

const readEnvFile = (relative) =>
  parseEnv(readFileSync(path.join(repoRoot, relative), "utf8"));

const required = (env, key, file) => {
  const value = env[key]?.trim();

  if (!value) throw new Error(`db:lane: ${key} is not set in ${file}.`);

  return value;
};

async function main() {
  const branch = execFileSync("git", ["branch", "--show-current"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  const file = "packages/db/.env.test";
  const env = readEnvFile(file);
  const appUrl = required(env, "DATABASE_URL_TEST", file);
  const ownerUrl = required(env, "DATABASE_URL_TEST_OWNER", file);
  const superuserUrl = required(env, "DATABASE_URL_TEST_SUPERUSER", file);

  const base = databaseOf(ownerUrl);
  const slug = slugBranch(branch, slugCap(base));
  const name = laneDatabaseName(base, slug);
  const owner = roleOf(ownerUrl);
  const app = roleOf(appUrl);

  // `postgres` is `@repo/db`'s dependency, not the root's; resolved from there
  // rather than added to the root for one script.
  const postgres = createRequire(
    path.join(repoRoot, "packages", "db", "package.json"),
  )("postgres");
  const quiet = { max: 1, onnotice: () => undefined };

  const cluster = postgres(superuserUrl, quiet);
  let created = false;

  try {
    const [template] = await cluster`
      select pg_get_userbyid(datdba) as owner from pg_database where datname = ${base}`;

    if (!template) {
      throw new Error(
        `db:lane: ${base} does not exist; the lane's database is created beside it (ADR-0007, docker/local/postgres/init/01-test-db.sql).`,
      );
    }

    const existing = await cluster`
      select 1 from pg_database where datname = ${name}`;

    if (existing.length === 0) {
      try {
        await cluster.unsafe(
          `create database ${ident(name)} owner ${ident(template.owner)}`,
        );
        created = true;
      } catch (error) {
        // Two sessions on one branch raced to create it: the other won.
        if (error?.code !== "42P04") throw error;
      }
    }

    await cluster.unsafe(
      `grant connect, create on database ${ident(name)} to ${ident(owner)}`,
    );
    await cluster.unsafe(
      `grant connect on database ${ident(name)} to ${ident(app)}`,
    );
  } finally {
    await cluster.end();
  }

  // The schema half of the init script, which has to run inside the database.
  // `public` is absent only while a harness rebuild is half done; the owner
  // recreates it, so there is nothing to hand over then.
  const lane = postgres(withDatabase(superuserUrl, name), quiet);

  try {
    const [schema] = await lane`
      select 1 as present from pg_namespace where nspname = 'public'`;

    if (schema) {
      await lane.unsafe(`alter schema public owner to ${ident(owner)}`);
      await lane.unsafe(`grant usage on schema public to ${ident(app)}`);
    }
  } finally {
    await lane.end();
  }

  process.stderr.write(
    `db:lane ✓ ${name} ${created ? "created" : "already there"} for ${branch.trim()} — export TEST_DB_LANE=${slug}\n`,
  );
  process.stdout.write(`${slug}\n`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main();
  } catch (error) {
    // The message alone: a connection error can carry the URL it failed on.
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
