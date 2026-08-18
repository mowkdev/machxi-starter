import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * True when `moduleUrl` is the file Node was asked to run, false when it was
 * imported by something else.
 *
 * The `db:*` scripts are both CLI entry points and importable functions — the
 * integration tests call `runMigrations()` and `runSeeders()` directly so they
 * exercise the same code path a developer runs (ADR-0021: "tests exercise the
 * real seed path"). Without this guard, importing one of them would run it.
 *
 * `realpathSync` on both sides so a symlinked checkout, a pnpm store link or a
 * Windows short path compares equal; a plain string comparison of `argv[1]`
 * against `import.meta.url` does not survive any of the three.
 */
export const isEntryPoint = (moduleUrl: string): boolean => {
  const invoked = process.argv[1];

  if (invoked === undefined) {
    return false;
  }

  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
};
