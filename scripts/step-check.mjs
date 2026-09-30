#!/usr/bin/env node
// `pnpm step:check` — the step check (ADR-0082 §2): what a step runs before it
// commits, sized to the change rather than to the tree.
//
//   1. `pnpm check` — the cached fast loop: lint (carrying the script tests
//      and the document checks), types, unit.
//   2. The integration files the change reaches: for each package turbo puts
//      in `--filter="...[<base>]"` that has a `test:int`, that package's
//      integration config run with `vitest run --changed <base>`, so only the
//      files importing a changed module run — under the `tiers` lock
//      (`scripts/with-lock.mjs`). When the diff touches what the tier is
//      built from rather than what a test imports — a migration, the harness,
//      an `.env.test`, an integration config, a manifest — no import edge
//      reaches it, so the reached packages run every integration file instead.
//      A file that fails is re-run in its set first, with the same arguments:
//      failing there again makes it the step's defect, since a file that fails
//      only after another is an order dependence the tier's one database
//      carries. A file that passes in the set is re-run alone: passing alone
//      twice makes it a flake, reported by name and not failing the check;
//      failing alone makes it the step's defect.
//   3. `pnpm size` only when an SPA is in that filter — a platform package
//      reaches both SPAs through it. The script takes the lock itself.
//   4. `pnpm format:check` over the tree.
//
// `<base>` is `git merge-base origin/main HEAD`, the point the lane branched
// from; `--base <ref>` overrides it. Both turbo's filter and vitest's
// `--changed` compare the working tree, so the check runs before the commit.
// Nothing is forced cold: a cached result is a proof (ADR-0026 §The rule).
// The whole tree is the gate's, by CI on every push and locally once at ship.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { withLock } from "./with-lock.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** The lock the contended tiers share. */
export const LOCK_NAME = "tiers";

const NONEXISTENT = "<NONEXISTENT>";

/**
 * Repo-relative paths an integration tier is built from without any test
 * file importing them: vitest's `--changed` follows import edges, so a
 * change here would select no file. The patterns are matched here, against
 * repo-relative paths, rather than as vitest's `forceRerunTriggers`: vitest
 * matches those against absolute paths, and picomatch's `**` does not cross
 * a dot-directory, so in a worktree under `.claude/worktrees/` none of them —
 * not even vitest's own default for a changed `package.json` — would match.
 */
export const INTEGRATION_TRIGGERS = [
  /(^|\/)package\.json$/,
  /^pnpm-lock\.yaml$/,
  /(^|\/)vite(st)?(\.[a-z]+)?\.config\.[cm]?[jt]s$/,
  /(^|\/)\.env\.test$/,
  /(^|\/)test\/setup\//,
  /^packages\/config-vitest\//,
  /^packages\/db\/migrations\//,
  /^packages\/db\/src\/(testing|migrate|reset|client)\.ts$/,
  /^packages\/db\/src\/tooling\//,
];

/** The first changed path that makes `--changed` blind, or `null`. */
export function harnessTrigger(files) {
  return (
    files.find((file) =>
      INTEGRATION_TRIGGERS.some((pattern) => pattern.test(file)),
    ) ?? null
  );
}

/**
 * What the change reaches, from `turbo run test:int size --dry=json` over the
 * affected filter: the packages with an integration tier and their configs,
 * and whether any SPA's `size` is in it.
 */
export function affectedTiers(dry) {
  const real = (dry.tasks ?? []).filter(
    (task) => task.command && task.command !== NONEXISTENT,
  );

  const integration = real
    .filter((task) => task.task === "test:int")
    .map((task) => ({
      name: task.package,
      directory: task.directory,
      config:
        /--config[= ](\S+)/.exec(task.command)?.[1] ?? "vitest.int.config.ts",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const size = real
    .filter((task) => task.task === "size")
    .map((task) => task.package)
    .sort();

  return { integration, size };
}

/** The files a vitest JSON report marks failed, relative to the package. */
export function failedFiles(report, directory) {
  return (report?.testResults ?? [])
    .filter((result) => result.status === "failed")
    .map((result) => path.relative(directory, result.name))
    .sort();
}

const readReport = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

/** Runs a command; resolves to `{ code, stdout }` (stdout only if captured). */
export function run(command, args, { cwd = repoRoot, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
      shell: process.platform === "win32",
    });
    let stdout = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code, signal) =>
      resolve({ code: code ?? (signal ? 1 : 0), stdout }),
    );
  });
}

/**
 * The step check. `exec` and `lock` are the seams the tests stub; the result
 * says what ran, what was skipped and why, and what failed or flaked.
 */
export async function stepCheck({
  base,
  root = repoRoot,
  exec = run,
  lock = (name, fn) => withLock(name, fn),
  log = (line) => process.stderr.write(`${line}\n`),
} = {}) {
  const result = { base, ran: [], skipped: [], failed: [], flakes: [] };
  const step = async (label, command, args, options) => {
    log(`step:check → ${label}`);
    result.ran.push(label);
    const { code } = await exec(command, args, { cwd: root, ...options });
    if (code !== 0) result.failed.push(label);
    return code === 0;
  };

  if (!(await step("check", "pnpm", ["check"]))) return result;

  const dry = await exec(
    "pnpm",
    [
      "exec",
      "turbo",
      "run",
      "test:int",
      "size",
      `--filter=...[${base}]`,
      "--dry=json",
    ],
    { cwd: root, capture: true },
  );

  if (dry.code !== 0) {
    result.failed.push("turbo --dry");
    return result;
  }

  const { integration, size } = affectedTiers(JSON.parse(dry.stdout));

  if (integration.length === 0) {
    result.skipped.push("integration: no package with a test:int is reached");
  } else {
    const trigger = harnessTrigger(await changedFiles({ base, root, exec }));
    const reports = mkdtempSync(path.join(os.tmpdir(), "step-check-"));

    try {
      await lock(LOCK_NAME, async () => {
        for (const pkg of integration)
          await integrationFiles(pkg, {
            base,
            trigger,
            root,
            exec,
            log,
            reports,
            result,
          });
      });
    } finally {
      rmSync(reports, { recursive: true, force: true });
    }

    if (result.failed.length > 0) return result;
  }

  if (size.length === 0) {
    result.skipped.push("size: no SPA is reached");
  } else if (!(await step(`size (${size.join(", ")})`, "pnpm", ["size"]))) {
    return result;
  }

  await step("format:check", "pnpm", ["format:check"]);

  return result;
}

/** Every path the working tree differs from `base` by, tracked or not. */
async function changedFiles({ base, root, exec }) {
  const lists = await Promise.all([
    exec("git", ["diff", "--name-only", base], { cwd: root, capture: true }),
    exec("git", ["ls-files", "--others", "--exclude-standard"], {
      cwd: root,
      capture: true,
    }),
  ]);

  for (const list of lists)
    if (list.code !== 0)
      throw new Error("step:check: git could not list the changed files.");

  return lists.flatMap(({ stdout }) => stdout.split("\n").filter(Boolean));
}

async function integrationFiles(
  pkg,
  { base, trigger, root, exec, log, reports, result },
) {
  const cwd = path.join(root, pkg.directory);
  const reportFor = (run) =>
    path.join(reports, `${pkg.name.replace(/\W+/g, "-")}.${run}.json`);
  const vitest = (files, extra = []) =>
    exec(
      "pnpm",
      ["exec", "vitest", "run", "--config", pkg.config, ...extra, ...files],
      { cwd },
    );
  // The set: the files `--changed` selects, or every file when the diff
  // touches what the tier is built from (`INTEGRATION_TRIGGERS`).
  const set = (report) => [
    ...(trigger ? [] : ["--changed", base]),
    "--passWithNoTests",
    "--reporter=default",
    "--reporter=json",
    `--outputFile.json=${report}`,
  ];
  const label = trigger
    ? `integration ${pkg.name} (every file: ${trigger} changed)`
    : `integration ${pkg.name} (--changed ${base.slice(0, 12)})`;

  log(`step:check → ${label}`);
  result.ran.push(label);

  const first = await vitest([], set(reportFor("first")));
  const firstReport = readReport(reportFor("first"));
  const files = firstReport?.testResults?.length;

  if (files !== undefined)
    result.ran[result.ran.indexOf(label)] = `${label}: ${files} file(s)`;

  if (first.code === 0) return;

  const failed = failedFiles(firstReport, cwd);

  // A red run with no failed file is a setup or collection error: not a flake.
  if (failed.length === 0) {
    result.failed.push(`${label}: the run failed before any file did`);
    return;
  }

  // The set again, as it ran: a file that fails there twice fails because of
  // what ran before it — most often state the step's own file leaves in the
  // one database — and passing alone, on a rebuilt database, would hide that.
  log(`step:check → re-running ${pkg.name}'s set`);
  const again = await vitest([], set(reportFor("again")));
  const againFailed = new Set(
    again.code === 0 ? [] : failedFiles(readReport(reportFor("again")), cwd),
  );

  if (again.code !== 0 && againFailed.size === 0) {
    result.failed.push(`${label}: the re-run failed before any file did`);
    return;
  }

  for (const file of failed) {
    if (againFailed.has(file)) {
      result.failed.push(`${pkg.directory}/${file}`);
      continue;
    }

    log(`step:check → re-running ${pkg.name} ${file} alone`);
    const alone = [await vitest([file])];
    if (alone[0].code === 0) alone.push(await vitest([file]));

    if (alone.every(({ code }) => code === 0)) {
      result.flakes.push(`${pkg.directory}/${file}`);
    } else {
      result.failed.push(`${pkg.directory}/${file}`);
    }
  }
}

/** The lines `pnpm step:check` ends on. */
export function summary(result) {
  const lines = [`step:check against ${result.base}`];

  for (const label of result.ran) lines.push(`  ran      ${label}`);
  for (const reason of result.skipped) lines.push(`  skipped  ${reason}`);
  for (const file of result.flakes)
    lines.push(
      `  FLAKE    ${file} — failed in the run, passed in its set and alone twice; owed a hardening step`,
    );
  for (const failure of result.failed) lines.push(`  FAILED   ${failure}`);

  lines.push(result.failed.length === 0 ? "step:check ✓" : "step:check ✗");

  return lines.join("\n");
}

export function parseArgs(argv) {
  if (argv.length === 0) return {};
  if (argv[0] === "--base" && argv[1] && argv.length === 2)
    return { base: argv[1] };
  throw new Error("usage: step-check [--base <ref>]");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let base = args.base;

  if (!base) {
    const found = await run("git", ["merge-base", "origin/main", "HEAD"], {
      capture: true,
    });
    base = found.stdout.trim();
    if (found.code !== 0 || !base)
      throw new Error(
        "step:check: no merge base with origin/main — fetch origin, or pass --base <ref>.",
      );
  }

  if (!process.env.TEST_DB_LANE)
    process.stderr.write(
      "step:check: TEST_DB_LANE is unset, so integration files run on machxi_test; a lane exports $(pnpm --silent db:lane) (ADR-0082 §3).\n",
    );

  const result = await stepCheck({ base });

  process.stderr.write(`\n${summary(result)}\n`);
  process.exitCode = result.failed.length === 0 ? 0 : 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
