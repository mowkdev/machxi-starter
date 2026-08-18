/**
 * `pnpm test:postman` — runs `docs/postman` headless with newman (ADR-0021).
 *
 * A Node script rather than a bare `newman run …` line for two reasons. The
 * collection needs the seeded super admin's credentials, which are deliberately
 * *not* in the committed environment file — they live in `.env`, and this reads
 * them from there and passes them in as `--env-var`. And a `$VAR` in a package
 * script would expand in bash and not in the shell pnpm uses on Windows, so the
 * one place that reads the environment has to be portable code.
 *
 * Nothing here calls `process.exit()`. Killing the process while the readiness
 * `fetch` still holds a socket trips a libuv assertion on Windows and replaces
 * the exit code with a native crash code — so failures set `process.exitCode`
 * and return, and Node exits once its handles are closed. The exit code is the
 * whole point of the script: it is what makes this usable as a CI step.
 *
 * `--no-deprecation` in the package script silences a `fs.F_OK` warning from one
 * of newman's dependencies. It is not actionable here, and a warning printed on
 * every run is how people learn to stop reading output.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import newman from "newman";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const collection = path.join(
  root,
  "docs/postman/machxi-api.postman_collection.json",
);
const environment = path.join(
  root,
  "docs/postman/local.postman_environment.json",
);
const envFile = path.join(root, ".env");

/**
 * `process.stderr` rather than `console.error`: `no-console` is on everywhere,
 * CLI scripts included (ADR-0005 §Scope), and this file sits outside every lint
 * rule's reach, so the rule has to be kept by hand. Same shape as the `db:*`
 * scripts' `writeErrorLine` (`packages/db/src/tooling/report.ts`).
 */
const writeErrorLine = (text) => {
  process.stderr.write(`${text}\n`);
};

const fail = (...lines) => {
  writeErrorLine(["", ...lines, ""].join("\n"));
  process.exitCode = 1;
};

/** Resolves once newman is done; sets the exit code on any failed assertion. */
const run = (options) =>
  new Promise((resolve) => {
    newman.run(options, (error, summary) => {
      if (error) {
        writeErrorLine(error.stack ?? String(error));
        process.exitCode = 1;
        resolve();
        return;
      }

      const failures = summary.run.failures.length;

      if (failures > 0) {
        writeErrorLine(
          `\nnewman: ${String(failures)} assertion(s) failed. Stale dev fixtures are the ` +
            "usual cause — re-seed with `pnpm db:seed -- --dev`.\n",
        );
        process.exitCode = 1;
      }

      resolve();
    });
  });

const main = async () => {
  if (!existsSync(envFile)) {
    fail(
      "No .env at the repo root.",
      "",
      "  cp .env.example .env",
      "",
      "The collection signs in as the account SEED_SUPER_ADMIN_* describes, so the",
      "run needs the same file `pnpm db:setup` seeded from.",
    );
    return;
  }

  // Node's own loader, so the file is parsed exactly the way `pnpm dev` parses it.
  process.loadEnvFile(envFile);

  const email = process.env.SEED_SUPER_ADMIN_EMAIL;
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;

  if (!email || !password) {
    fail(
      "SEED_SUPER_ADMIN_EMAIL / SEED_SUPER_ADMIN_PASSWORD are missing from .env.",
      "",
      "Without them the seeder creates no super admin, so there is nobody for the",
      "collection to sign in as.",
    );
    return;
  }

  // `baseUrl` otherwise comes from the environment file; PORT only overrides it
  // when the API was moved off its default, which is the one case where the
  // committed value would be wrong.
  const baseUrl = `http://localhost:${process.env.PORT ?? "4000"}`;

  // A readiness probe first: "connect ECONNREFUSED" repeated 63 times is a
  // worse diagnosis than one sentence naming the command that starts the API.
  const probe = await fetch(`${baseUrl}/health/ready`).catch((error) => error);

  if (probe instanceof Error) {
    fail(
      `The API is not answering on ${baseUrl}.`,
      "",
      "  pnpm docker:up",
      "  pnpm db:setup && pnpm db:seed -- --dev",
      "  pnpm dev --filter api",
      "",
      `(${probe.message})`,
    );
    return;
  }

  // Read the body even when it is not needed: an unread response keeps its
  // socket open, and the process would then linger after newman is done.
  const health = await probe.json().catch(() => undefined);

  if (!probe.ok) {
    fail(
      `${baseUrl}/health/ready answered ${String(probe.status)}.`,
      "",
      "A dependency is down. `pnpm docker:up` starts Postgres; the failing",
      "indicator is named in the response:",
      "",
      `  ${JSON.stringify(health?.error?.details ?? health ?? "(no body)")}`,
    );
    return;
  }

  await run({
    collection,
    environment,
    envVar: [
      { key: "baseUrl", value: baseUrl },
      { key: "superAdminEmail", value: email },
      { key: "superAdminPassword", value: password },
    ],
    reporters: ["cli"],
    // Every folder after a failure still runs: a broken teardown should not
    // hide a broken list endpoint, and the report is more useful whole.
    bail: false,
  });
};

await main();
