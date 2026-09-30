import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

import { integrationConfig } from "@repo/vitest-config/node";
import { mergeConfig } from "vitest/config";

/**
 * Integration run (ADR-0021): real Postgres through the committed
 * `packages/db/.env.test` (ADR-0004 §File layout, as carried by ADR-0082 §3).
 *
 * `test.env` puts the file's values into every forked worker over whatever
 * the shell exported — the precedence `apps/api/.env.test` has through
 * `override: true` — so the database this tier rebuilds is named by a
 * committed file, never by the untracked root `.env`, which
 * `src/tooling/env.ts` still loads beneath it for everything else.
 */
const envFile = resolve(dirname(fileURLToPath(import.meta.url)), ".env.test");

export default mergeConfig(integrationConfig, {
  test: {
    env: parseEnv(readFileSync(envFile, "utf8")),
  },
});
