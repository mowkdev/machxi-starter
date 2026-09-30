// The lock the contended tiers run under (ADR-0082 §2). Each case works in a
// temporary lock directory of its own, never the clone's.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  acquire,
  HELD_ENV,
  holderIsGone,
  LockTimeoutError,
  parseArgs,
  withLock,
} from "./with-lock.mjs";

const script = fileURLToPath(new URL("./with-lock.mjs", import.meta.url));

const tempDir = () => mkdtempSync(path.join(os.tmpdir(), "with-lock-"));

const quiet = { log: () => undefined, pollMs: 10 };

/**
 * The command line's environment: never the lock this run may itself be
 * under — the gate at ship runs `test:scripts` inside the `tiers` lock, and
 * an inherited `MACHXI_LOCKS_HELD` would let the CLI skip the wait.
 */
const cliEnv = { ...process.env, [HELD_ENV]: "" };

/** A stale lock directory: a holder on this host whose process is gone. */
const staleLock = (dir) => {
  const lock = path.join(dir, "tiers.lock");

  mkdirSync(lock);
  writeFileSync(
    path.join(lock, "holder.json"),
    JSON.stringify({
      id: "gone",
      pid: deadPid(),
      host: os.hostname(),
      since: "then",
    }),
  );

  return lock;
};

/** A pid that certainly ran and certainly is not running now. */
const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid;

const settled = async (promise, ms) =>
  Promise.race([
    promise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), ms)),
  ]);

describe("with-lock", () => {
  it("a second holder waits until the first releases", async () => {
    const dir = tempDir();
    const lines = [];
    const releaseFirst = await acquire("tiers", {
      ...quiet,
      dir,
      command: "pnpm test:int",
    });
    const second = acquire("tiers", {
      ...quiet,
      dir,
      log: (line) => lines.push(line),
    });

    assert.equal(await settled(second, 150), false, "took a held lock");
    assert.match(lines.join("\n"), /waiting for the "tiers" lock, held by pid/);
    assert.match(lines.join("\n"), /`pnpm test:int`/);

    releaseFirst();

    assert.equal(await settled(second, 2000), true, "never took the lock");
    (await second)();
    assert.equal(existsSync(path.join(dir, "tiers.lock")), false);
  });

  it("a lock whose holder is gone is taken over", async () => {
    const dir = tempDir();
    const lock = path.join(dir, "tiers.lock");
    const pid = deadPid();

    mkdirSync(lock);
    writeFileSync(
      path.join(lock, "holder.json"),
      JSON.stringify({ id: "gone", pid, host: os.hostname(), since: "then" }),
    );
    assert.equal(holderIsGone({ pid, host: os.hostname() }), true);

    const lines = [];
    const release = await acquire("tiers", {
      ...quiet,
      dir,
      timeoutMs: 2000,
      log: (line) => lines.push(line),
    });

    assert.match(lines.join("\n"), /holder is gone/);
    release();
  });

  it("a timeout is reported, not skipped", async () => {
    const dir = tempDir();
    const release = await acquire("tiers", {
      ...quiet,
      dir,
      command: "pnpm size",
    });

    await assert.rejects(
      acquire("tiers", { ...quiet, dir, timeoutMs: 100 }),
      (error) =>
        error instanceof LockTimeoutError &&
        /timed out after \d+s waiting for the "tiers" lock/.test(
          error.message,
        ) &&
        error.message.includes("`pnpm size`") &&
        /the command did not run/.test(error.message),
    );

    // Through the command line: the command is not run and the exit is red.
    const marker = path.join(dir, "ran");
    const result = spawnSync(
      process.execPath,
      [
        script,
        "tiers",
        "--timeout",
        "0.2",
        "--dir",
        dir,
        "--",
        process.execPath,
        "-e",
        `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "")`,
      ],
      { encoding: "utf8", env: cliEnv },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /timed out after/);
    assert.equal(existsSync(marker), false, "the command ran anyway");
    release();
  });

  it("a takeover another waiter has claimed is left to it", async () => {
    const dir = tempDir();

    mkdirSync(path.join(staleLock(dir), "takeover"));

    await assert.rejects(
      acquire("tiers", { ...quiet, dir, timeoutMs: 150 }),
      LockTimeoutError,
    );
    assert.equal(existsSync(path.join(dir, "tiers.lock", "takeover")), true);
  });

  it("a claim left by a waiter that died is cleared, and the lock taken", async () => {
    const dir = tempDir();
    const claim = path.join(staleLock(dir), "takeover");
    const old = new Date(Date.now() - 60_000);

    mkdirSync(claim);
    utimesSync(claim, old, old);

    const release = await acquire("tiers", { ...quiet, dir, timeoutMs: 2000 });
    release();
    assert.equal(existsSync(path.join(dir, "tiers.lock")), false);
  });

  it("a live holder on this host is not gone", () => {
    assert.equal(
      holderIsGone({ pid: process.pid, host: os.hostname() }),
      false,
    );
    assert.equal(holderIsGone({ pid: deadPid(), host: "elsewhere" }), false);
  });

  it("the command runs holding the lock, and its exit code is kept", () => {
    const dir = tempDir();
    const result = spawnSync(
      process.execPath,
      [
        script,
        "tiers",
        "--dir",
        dir,
        "--",
        process.execPath,
        "-e",
        `const fs = require("node:fs");
         if (!fs.existsSync(${JSON.stringify(path.join(dir, "tiers.lock"))})) process.exit(9);
         process.exit(process.env.${HELD_ENV} === "tiers" ? 3 : 8);`,
      ],
      { encoding: "utf8", env: cliEnv },
    );

    assert.equal(result.status, 3, result.stderr);
    assert.equal(existsSync(path.join(dir, "tiers.lock")), false);
  });

  it("a nested call for a lock this tree holds runs at once", async () => {
    const dir = tempDir();
    const env = {};
    let ran = false;

    await withLock(
      "tiers",
      () =>
        withLock(
          "tiers",
          async () => {
            ran = true;
          },
          { ...quiet, dir, env, timeoutMs: 100 },
        ),
      { ...quiet, dir, env },
    );

    assert.equal(ran, true);
    assert.equal(env[HELD_ENV], undefined);
    assert.equal(existsSync(path.join(dir, "tiers.lock")), false);
  });

  it("the arguments need a name and a command", () => {
    assert.deepEqual(parseArgs(["tiers", "--", "pnpm", "size"]), {
      name: "tiers",
      options: {},
      command: ["pnpm", "size"],
    });
    assert.throws(() => parseArgs(["--", "pnpm"]), /usage/);
    assert.throws(() => parseArgs(["tiers", "--"]), /usage/);
    assert.throws(() => parseArgs(["tiers", "--wait", "--", "x"]), /flag/);
  });
});
