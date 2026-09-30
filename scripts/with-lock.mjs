#!/usr/bin/env node
// `node scripts/with-lock.mjs <name> [--timeout <seconds>] -- <command…>` —
// runs a command while holding a named lock every checkout of this clone
// shares (ADR-0082 §2).
//
// Two lanes on one machine share its CPU and its Postgres. The tiers that
// contend for them — `test`, `test:int`, `size`, `test:e2e` — run inside this
// lock, so a second lane waits, printing who holds the lock, rather than
// colliding with the first or asking it. A cloud session is its own machine
// and holds its own lock.
//
// The lock is a directory, `<git common dir>/machxi-locks/<name>.lock`: the
// git common directory is the one every worktree of a clone shares, wherever
// the worktree sits, and it is never tracked. The directory appears whole —
// built under a temporary name with its `holder.json` inside, then renamed
// into place — so a reader never sees a lock without its holder. A holder
// whose process is gone (same host, pid no longer running) is taken over by
// one waiter at a time, under a claim; one that outlives the timeout is
// reported with its holder, and the command does not run.
//
// A nested call for a lock this process tree already holds runs at once:
// `MACHXI_LOCKS_HELD` carries the held names to the children, so the gate run
// under the lock at ship reaches `pnpm test` and `pnpm size`, which take it
// themselves, without waiting on its own parent.

import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** The environment variable naming the locks this process tree holds. */
export const HELD_ENV = "MACHXI_LOCKS_HELD";

/** One hour: longer than the whole gate on a loaded laptop. */
export const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;

const DEFAULT_POLL_MS = 1000;

/** A lock directory with no readable holder this old is debris. */
const HOLDERLESS_GRACE_MS = 10_000;

/** A takeover claim this old was left by a waiter that died holding it. */
const CLAIM_GRACE_MS = 30_000;

export class LockTimeoutError extends Error {
  constructor(name, holder, waitedMs) {
    super(
      `with-lock: timed out after ${Math.round(waitedMs / 1000)}s waiting for the "${name}" lock, held by ${describeHolder(holder)}; the command did not run (ADR-0082 §2).`,
    );
    this.name = "LockTimeoutError";
    this.holder = holder;
  }
}

/** Where the named locks live: the git directory every worktree shares. */
export function defaultLockDir(cwd = repoRoot) {
  try {
    const common = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();

    return path.join(common, "machxi-locks");
  } catch {
    // Not a git checkout (an image build context): the machine's temp dir.
    return path.join(os.tmpdir(), "machxi-locks");
  }
}

const heldNames = (env = process.env) =>
  (env[HELD_ENV] ?? "").split(",").filter(Boolean);

/** `pid 123 on host (branch, `pnpm test:int`) since …` — or unknown. */
export function describeHolder(holder) {
  if (!holder) return "an unknown holder";

  const where = [holder.branch, holder.cwd].filter(Boolean).join(" in ");
  const what = holder.command ? `\`${holder.command}\`` : "a command";

  return `pid ${holder.pid} on ${holder.host} (${what}${where ? `, ${where}` : ""}) since ${holder.since}`;
}

const readHolder = (lockPath) => {
  try {
    return JSON.parse(readFileSync(path.join(lockPath, "holder.json"), "utf8"));
  } catch {
    return null;
  }
};

const ageMs = (lockPath, now) => {
  try {
    return now - statSync(lockPath).mtimeMs;
  } catch {
    return 0;
  }
};

/** True when the holder's process is certainly gone. */
export function holderIsGone(holder, { host = os.hostname() } = {}) {
  if (!holder || holder.host !== host || !Number.isInteger(holder.pid))
    return false;

  try {
    process.kill(holder.pid, 0);
    return false;
  } catch (error) {
    // EPERM: it exists and belongs to someone else — alive.
    return error?.code === "ESRCH";
  }
}

const branchOf = (cwd) => {
  try {
    return execFileSync("git", ["branch", "--show-current"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Takes the named lock, waiting up to `timeoutMs`, and resolves to a
 * `release` function. Rejects with `LockTimeoutError` when the wait runs out.
 */
export async function acquire(name, options = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new Error(
      `with-lock: ${JSON.stringify(name)} is not a lock name (lower-case letters, digits and hyphens).`,
    );
  }

  const {
    dir = defaultLockDir(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    pollMs = DEFAULT_POLL_MS,
    command = "",
    cwd = process.cwd(),
    log = (line) => process.stderr.write(`${line}\n`),
    now = () => Date.now(),
  } = options;

  mkdirSync(dir, { recursive: true });

  const lockPath = path.join(dir, `${name}.lock`);
  const holder = {
    id: randomUUID(),
    pid: process.pid,
    host: os.hostname(),
    cwd,
    branch: branchOf(cwd),
    command,
    since: new Date(now()).toISOString(),
  };
  const started = now();
  let reported = null; // the holder last printed, so a wait prints each once

  for (;;) {
    // Build the lock under a private name, then rename it into place: the
    // rename is atomic and fails while another holder's directory is there.
    const staging = path.join(dir, `.${name}.${holder.id}`);

    mkdirSync(staging);
    holder.since = new Date(now()).toISOString();
    writeFileSync(
      path.join(staging, "holder.json"),
      `${JSON.stringify(holder)}\n`,
    );

    try {
      renameSync(staging, lockPath);

      if (reported) log(`with-lock: took the "${name}" lock.`);

      return () => release(lockPath, holder.id, dir);
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      if (!["ENOTEMPTY", "EEXIST", "EPERM", "EISDIR"].includes(error?.code))
        throw error;
    }

    const current = readHolder(lockPath);
    const stale = current
      ? holderIsGone(current)
      : ageMs(lockPath, now()) > HOLDERLESS_GRACE_MS;

    if (stale && takeOver(lockPath, current, dir, now())) {
      log(
        `with-lock: the "${name}" lock's holder is gone (${describeHolder(current)}); taking it over.`,
      );
      continue;
    }

    if (now() - started >= timeoutMs)
      throw new LockTimeoutError(name, current, now() - started);

    const key = current?.id ?? "unknown";

    if (key !== reported) {
      log(
        `with-lock: waiting for the "${name}" lock, held by ${describeHolder(current)}.`,
      );
      reported = key;
    }

    await sleep(pollMs);
  }
}

/**
 * Removes a stale lock, claiming it first. Two waiters can read the same dead
 * holder; moving the directory straight away would let the slower one move
 * the faster one's live lock aside. So the taker first creates `takeover`
 * inside the stale directory — `mkdir` is atomic, and only one waiter gets
 * it — then re-reads the holder under its claim, and removes the directory
 * only if it is still the one read as stale. A claim older than
 * `CLAIM_GRACE_MS` belongs to a waiter that died mid-takeover and is cleared.
 */
function takeOver(lockPath, stale, dir, now) {
  const claim = path.join(lockPath, "takeover");

  try {
    mkdirSync(claim);
  } catch (error) {
    // EEXIST: another waiter holds the claim. ENOENT: the lock is already
    // gone. Either way the caller goes round again.
    if (error?.code === "EEXIST" && ageMs(claim, now) > CLAIM_GRACE_MS)
      rmSync(claim, { recursive: true, force: true });

    return false;
  }

  if (readHolder(lockPath)?.id !== stale?.id) {
    rmSync(claim, { recursive: true, force: true });
    return false;
  }

  const tomb = path.join(dir, `.stale.${randomUUID()}`);

  try {
    renameSync(lockPath, tomb);
  } catch {
    rmSync(claim, { recursive: true, force: true });
    return false;
  }

  rmSync(tomb, { recursive: true, force: true });

  return true;
}

function release(lockPath, id, dir) {
  if (readHolder(lockPath)?.id !== id) return;

  const tomb = path.join(dir, `.released.${id}`);

  try {
    renameSync(lockPath, tomb);
    rmSync(tomb, { recursive: true, force: true });
  } catch {
    // Already gone.
  }
}

/**
 * Runs `fn` holding the named lock, and lets the children it spawns see the
 * lock as held. A lock this process tree already holds is not taken again.
 */
export async function withLock(name, fn, options = {}) {
  const env = options.env ?? process.env;
  const held = heldNames(env);

  if (held.includes(name)) return fn();

  const release = await acquire(name, options);
  const previous = env[HELD_ENV];

  env[HELD_ENV] = [...held, name].join(",");

  try {
    return await fn();
  } finally {
    if (previous === undefined) delete env[HELD_ENV];
    else env[HELD_ENV] = previous;
    release();
  }
}

/** `<name> [--timeout <seconds>] [--dir <path>] -- <command…>` */
export function parseArgs(argv) {
  const separator = argv.indexOf("--");

  if (separator < 1 || separator === argv.length - 1) {
    throw new Error(
      "usage: with-lock <name> [--timeout <seconds>] [--dir <path>] -- <command…>",
    );
  }

  const [name, ...flags] = argv.slice(0, separator);
  const options = {};

  for (let i = 0; i < flags.length; i += 2) {
    const [flag, value] = [flags[i], flags[i + 1]];

    if (flag === "--timeout" && Number(value) > 0)
      options.timeoutMs = Number(value) * 1000;
    else if (flag === "--dir" && value) options.dir = path.resolve(value);
    else throw new Error(`with-lock: unknown or incomplete flag ${flag}.`);
  }

  return { name, options, command: argv.slice(separator + 1) };
}

async function main() {
  const { name, options, command } = parseArgs(process.argv.slice(2));

  const code = await withLock(
    name,
    () =>
      new Promise((resolve, reject) => {
        const child = spawn(command[0], command.slice(1), {
          stdio: "inherit",
          shell: process.platform === "win32",
        });
        // Ctrl-C reaches the child from the terminal's process group; this
        // process stays until the child exits, so the lock is released. A
        // SIGTERM is sent to this process alone, so it is passed on.
        const ignore = () => undefined;
        const forward = () => child.kill("SIGTERM");

        process.on("SIGINT", ignore);
        process.on("SIGTERM", forward);
        child.on("error", reject);
        child.on("exit", (exitCode, signal) => {
          process.off("SIGINT", ignore);
          process.off("SIGTERM", forward);
          resolve(exitCode ?? (signal ? 1 : 0));
        });
      }),
    { ...options, command: command.join(" ") },
  );

  process.exitCode = code;
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
