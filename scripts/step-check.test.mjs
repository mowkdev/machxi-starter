// The step check's choices (ADR-0082 §2), with `turbo` and `vitest` stubbed:
// each case hands it turbo's dry run for a change and records what it runs.

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  affectedTiers,
  failedFiles,
  harnessTrigger,
  LOCK_NAME,
  stepCheck,
  summary,
} from "./step-check.mjs";

const root = "/repo";
const base = "0123456789abcdef0123456789abcdef01234567";

const task = (pkg, directory, name, command) => ({
  taskId: `${pkg}#${name}`,
  task: name,
  package: pkg,
  directory,
  command: command ?? "<NONEXISTENT>",
});

/** Turbo's dry run over `test:int size`, for the packages a change reaches. */
const DRY = {
  api: task(
    "api",
    "apps/api",
    "test:int",
    "vitest run --config vitest.int.config.ts --passWithNoTests",
  ),
  apiSize: task("api", "apps/api", "size"),
  db: task(
    "@repo/db",
    "packages/db",
    "test:int",
    "vitest run --config vitest.int.config.ts",
  ),
  grid: task("@repo/grid", "packages/grid", "test:int"),
  gridSize: task("@repo/grid", "packages/grid", "size"),
  admin: task("admin", "apps/admin", "size", "node ../../scripts/size.mjs"),
  adminInt: task("admin", "apps/admin", "test:int"),
};

/**
 * A stubbed `exec`: `pnpm exec turbo … --dry=json` answers with `tasks`,
 * `pnpm exec vitest …` with the next scripted `{ code, failed }` — writing the
 * JSON report the real reporter would — and everything else with 0.
 */
function harness({ tasks = [], vitest = [], changed = [] } = {}) {
  const calls = [];
  const locks = [];
  const scripted = [...vitest];

  const exec = async (command, args, options = {}) => {
    calls.push({ command, args, cwd: options.cwd });

    if (args[0] === "exec" && args[1] === "turbo")
      return { code: 0, stdout: JSON.stringify({ tasks }) };

    if (command === "git" && args[0] === "diff")
      return { code: 0, stdout: changed.map((file) => `${file}\n`).join("") };

    if (args[0] === "exec" && args[1] === "vitest") {
      const { code = 0, failed = [] } = scripted.shift() ?? {};
      const out = args.find((arg) => arg.startsWith("--outputFile.json="));

      if (out)
        writeFileSync(
          out.slice("--outputFile.json=".length),
          JSON.stringify({
            success: code === 0,
            testResults: failed.map((file) => ({
              name: path.join(options.cwd, file),
              status: "failed",
            })),
          }),
        );

      return { code, stdout: "" };
    }

    return { code: 0, stdout: "" };
  };

  const lock = async (name, fn) => {
    locks.push(name);
    return fn();
  };

  const vitestCalls = () =>
    calls.filter(({ args }) => args[0] === "exec" && args[1] === "vitest");
  const pnpm = (script) =>
    calls.filter(
      ({ command, args }) => command === "pnpm" && args[0] === script,
    );

  return { exec, lock, calls, locks, vitestCalls, pnpm };
}

const check = (h) =>
  stepCheck({ base, root, exec: h.exec, lock: h.lock, log: () => undefined });

describe("step-check", () => {
  it("a change under apps/api runs the api's integration files that import it and no other package's", async () => {
    const h = harness({
      tasks: [DRY.api, DRY.apiSize],
    });
    const result = await check(h);

    assert.deepEqual(result.failed, []);
    const runs = h.vitestCalls();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].cwd, path.join(root, "apps/api"));
    assert.deepEqual(runs[0].args.slice(0, 5), [
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.int.config.ts",
    ]);
    assert.ok(runs[0].args.includes("--changed"));
    assert.equal(runs[0].args[runs[0].args.indexOf("--changed") + 1], base);
    assert.deepEqual(h.locks, [LOCK_NAME]);
    assert.equal(h.pnpm("size").length, 0);
    assert.equal(h.pnpm("format:check").length, 1);
  });

  it("a change under packages/grid runs size and no integration file", async () => {
    // What turbo answers for a grid-only branch: the grid and the one SPA
    // that depends on it — the customer app does not import `@repo/grid`.
    const h = harness({
      tasks: [DRY.grid, DRY.gridSize, DRY.admin, DRY.adminInt],
    });
    const result = await check(h);

    assert.deepEqual(result.failed, []);
    assert.equal(h.vitestCalls().length, 0);
    assert.deepEqual(h.locks, []);
    assert.equal(h.pnpm("size").length, 1);
    assert.deepEqual(result.ran, ["check", "size (admin)", "format:check"]);
  });

  it("a documents-only change runs the fast loop and format:check alone", async () => {
    const h = harness({ tasks: [] });
    const result = await check(h);

    assert.deepEqual(result.ran, ["check", "format:check"]);
    assert.deepEqual(result.failed, []);
    assert.equal(h.vitestCalls().length, 0);
    assert.equal(h.pnpm("size").length, 0);
    assert.deepEqual(
      h.calls
        .filter(({ args }) => !(args[0] === "exec" && args[1] === "turbo"))
        .map(({ command, args }) => [command, ...args].join(" ")),
      ["pnpm check", "pnpm format:check"],
    );
  });

  it("a failed file that passes alone twice is reported as a flake", async () => {
    const flaky = "test/concurrency.int.test.ts";
    const h = harness({
      tasks: [DRY.api],
      // The run, its set again (green), then the file alone, twice.
      vitest: [
        { code: 1, failed: [flaky] },
        { code: 0 },
        { code: 0 },
        { code: 0 },
      ],
    });
    const result = await check(h);

    assert.deepEqual(result.failed, []);
    assert.deepEqual(result.flakes, [`apps/api/${flaky}`]);
    const [, again, ...reruns] = h.vitestCalls();
    assert.ok(again.args.includes("--changed"), "the set re-runs as it ran");
    assert.equal(reruns.length, 2);
    for (const rerun of reruns) {
      assert.equal(rerun.args.at(-1), flaky);
      assert.ok(!rerun.args.includes("--changed"));
    }
    assert.match(summary(result), /FLAKE {4}apps\/api\/test\/concurrency/);
    assert.match(summary(result), /step:check ✓/);
    assert.equal(h.pnpm("format:check").length, 1);
  });

  it("a failed file that fails alone is a failure", async () => {
    const broken = "test/users.int.test.ts";
    const h = harness({
      tasks: [DRY.api],
      vitest: [{ code: 1, failed: [broken] }, { code: 0 }, { code: 1 }],
    });
    const result = await check(h);

    assert.deepEqual(result.failed, [`apps/api/${broken}`]);
    assert.deepEqual(result.flakes, []);
    assert.equal(h.vitestCalls().length, 3);
    assert.match(summary(result), /step:check ✗/);
    assert.equal(h.pnpm("format:check").length, 0);
  });

  it("a file that passes alone once and then fails is a failure", async () => {
    const h = harness({
      tasks: [DRY.api],
      vitest: [
        { code: 1, failed: ["test/a.int.test.ts"] },
        { code: 0 },
        { code: 0 },
        { code: 1 },
      ],
    });

    assert.deepEqual((await check(h)).failed, ["apps/api/test/a.int.test.ts"]);
  });

  it("a file that fails in its set twice and passes alone is a failure, not a flake", async () => {
    // An order dependence: another file in the set leaves state behind, and
    // alone, on a rebuilt database, the file passes.
    const victim = "test/grants.int.test.ts";
    const h = harness({
      tasks: [DRY.api],
      vitest: [
        { code: 1, failed: [victim] },
        { code: 1, failed: [victim] },
        { code: 0 },
        { code: 0 },
      ],
    });
    const result = await check(h);

    assert.deepEqual(result.failed, [`apps/api/${victim}`]);
    assert.deepEqual(result.flakes, []);
    assert.equal(h.vitestCalls().length, 2, "ran it alone anyway");
    assert.match(summary(result), /step:check ✗/);
  });

  it("a migration-only change runs every integration file of the packages it reaches", async () => {
    const h = harness({
      tasks: [DRY.db, DRY.api],
      changed: [
        "packages/db/migrations/0024_lane_things.sql",
        "packages/db/migrations/meta/_journal.json",
      ],
    });
    const result = await check(h);

    assert.deepEqual(result.failed, []);
    const runs = h.vitestCalls();
    assert.deepEqual(
      runs.map(({ cwd }) => cwd),
      [path.join(root, "packages/db"), path.join(root, "apps/api")],
    );
    for (const { args } of runs) {
      assert.ok(!args.includes("--changed"), args.join(" "));
      assert.ok(args.includes("--passWithNoTests"));
    }
    assert.match(
      result.ran[1],
      /every file: packages\/db\/migrations\/0024_lane_things\.sql changed/,
    );
  });

  it("names the paths that make --changed blind, and only those", () => {
    for (const file of [
      "package.json",
      "apps/api/package.json",
      "pnpm-lock.yaml",
      "apps/api/vitest.int.config.ts",
      "packages/db/vitest.config.ts",
      "apps/api/.env.test",
      "packages/db/.env.test",
      "apps/api/test/setup/global-setup.ts",
      "packages/config-vitest/node.ts",
      "packages/db/migrations/meta/_journal.json",
      "packages/db/src/testing.ts",
      "packages/db/src/tooling/test-database.ts",
    ])
      assert.equal(harnessTrigger(["docs/x.md", file]), file);

    assert.equal(
      harnessTrigger([
        "apps/api/src/modules/users/users.service.ts",
        "packages/db/src/schema/users.ts",
        "docs/adr/0082-lanes-on-one-machine-and-one-main.md",
      ]),
      null,
    );
  });

  it("a red run with no failed file is a failure, not a flake", async () => {
    const h = harness({ tasks: [DRY.db], vitest: [{ code: 1, failed: [] }] });
    const result = await check(h);

    assert.equal(result.failed.length, 1);
    assert.match(result.failed[0], /integration @repo\/db .*before any file/);
    assert.equal(h.vitestCalls().length, 1);
  });

  it("a red fast loop stops the check", async () => {
    const h = harness({ tasks: [DRY.api] });
    const exec = async (command, args, options) =>
      args[0] === "check"
        ? { code: 1, stdout: "" }
        : h.exec(command, args, options);
    const result = await stepCheck({
      base,
      root,
      exec,
      lock: h.lock,
      log: () => undefined,
    });

    assert.deepEqual(result.failed, ["check"]);
    assert.equal(h.calls.length, 0);
  });

  it("reads each package's integration config from its test:int command", () => {
    const { integration, size } = affectedTiers({
      tasks: [DRY.db, DRY.api, DRY.grid, DRY.admin],
    });

    assert.deepEqual(integration, [
      {
        name: "@repo/db",
        directory: "packages/db",
        config: "vitest.int.config.ts",
      },
      { name: "api", directory: "apps/api", config: "vitest.int.config.ts" },
    ]);
    assert.deepEqual(size, ["admin"]);
  });

  it("names failed files relative to their package", () => {
    assert.deepEqual(
      failedFiles(
        {
          testResults: [
            { name: "/repo/apps/api/test/b.int.test.ts", status: "failed" },
            { name: "/repo/apps/api/test/a.int.test.ts", status: "passed" },
          ],
        },
        "/repo/apps/api",
      ),
      ["test/b.int.test.ts"],
    );
    assert.deepEqual(failedFiles(null, "/repo/apps/api"), []);
  });
});
