// The fork, rehearsed (ADR-0084 §1 and §2). The cases fork a copy of this tree
// the way `docs/forking.md` says a project does, and merge a simulated starter
// ship into it with the commands that document states, read from it, so the
// document and the test cannot drift:
//
// 1. The tree as it stands — tracked and untracked files, not ignored ones — is
//    copied under the OS temp directory and committed there as the starter.
// 2. The fork is a clone of it, with the remote renamed `starter`. It runs
//    `node scripts/bootstrap.mjs --prefix acme` and `node scripts/rename.mjs`,
//    commits each, and its `docs:check`, its script tests and Prettier's check
//    over every file those two wrote must pass. It then opens its first lane,
//    staged and not yet committed.
// 3. The starter ships: it edits a plan the fork deleted and its notes, opens
//    a lane with a plan, notes and a lane file of its own, adds a changelog
//    entry and a ledger row, and changes a file outside the journal.
// 4. The fork runs `docs/forking.md` §5's commands — every line of the block
//    that names no placeholder — over its staged lane: the merge refuses to
//    start, and the staged files must survive the command after it. It then
//    commits the lane, runs the commands again, commits the merge as the
//    section says, and its journal must be what it was, and its `docs:check`
//    clean.
//
// It reads the whole tree, which a cached root task cannot hash, so it is not
// in `test:scripts`: `pnpm test:fork` runs it, uncached, in the gate's `test`
// link and in `pnpm step:check` (ADR-0084 §1, amended at D36.2).
//
// Git reads no global or system config, nothing here writes to this
// repository, and nothing is installed: the fork reads this tree's root
// `node_modules` and each workspace's through symlinks. In a fork — a ledger
// whose tag prefix is not the starter's — there is no starter to rehearse and
// the suite skips; that is also what keeps the fork's own copy of this file,
// run by its script tests in step 2, from rehearsing again.

import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { STARTER_PREFIX } from "./bootstrap.mjs";
import { CHANGELOG, parseTagPrefix } from "./docs-hygiene.mjs";
import { LANES_DIR, LEDGER, findBlock, renderLanes } from "./lanes.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** The fork's tag prefix, and a product name longer than seventeen
 * characters, which a lane database's name once overflowed (D36.1). */
const PREFIX = "acme";
const NAME = "acme-fulfilment-platform";

/** The fork's first deliverable, and the starter's next. */
const FORK_PLAN = "docs/plan/0001-first-feature.md";
const FORK_NOTES = "docs/plan/0001-first-feature.notes.md";
const FORK_LANE = `${LANES_DIR}/D1.md`;
const STARTER_PLAN = "docs/plan/0099-rehearsal.md";
const STARTER_NOTES = "docs/plan/0099-rehearsal.notes.md";
const STARTER_LANE = `${LANES_DIR}/D99.md`;
/** A file outside the journal the starter adds, which the fork must take. */
const ARRIVES = "rehearsal/arrived.txt";

/** What `format:check` reads (the root manifest's glob). */
const FORMATTED = /\.(ts|tsx|mjs|md|json|css)$/;

/** The starter merge, as `scripts/merge-attributes.test.mjs` reads it. */
const STARTER_MERGE =
  /^git(?: -c merge\.[a-z]+\.driver=true)+ merge starter\/main$/;
/** A placeholder the reader fills in, such as `starter-D<n>`. */
const PLACEHOLDER = /<[^>\s]+>/;

/**
 * Git with no global or system config. Every inherited `GIT_*` key goes first:
 * a `GIT_DIR`, `GIT_INDEX_FILE` or `GIT_WORK_TREE` from a hook or a caller
 * would point the rehearsal's git at another repository — this one — and
 * `GIT_CONFIG_PARAMETERS` or `GIT_CONFIG_COUNT` would carry config past the
 * two keys below.
 */
const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);
Object.assign(gitEnv, {
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_MERGE_AUTOEDIT: "no",
  GIT_EDITOR: "true",
});
// The runner marks its children with this; a nested `node --test` that
// inherited it would report to the outer runner instead of running its own.
delete gitEnv.NODE_TEST_CONTEXT;

/** Every fenced `bash` block of a Markdown text, as its lines, dedented. */
export function bashBlocks(text) {
  const blocks = [];
  for (const m of text.matchAll(/^( *)```bash\n([\s\S]*?)^\1```$/gm)) {
    blocks.push(
      m[2]
        .split("\n")
        .map((line) => line.slice(m[1].length))
        .filter((line) => line.trim() !== ""),
    );
  }
  return blocks;
}

/** A command line without its trailing comment. */
const command = (line) => line.replace(/\s+#.*$/, "").trim();

/**
 * The starter merge's block in a document: the one `bash` block whose lines
 * include the merge, as commands. `null` when no block has it.
 */
export function starterMergeCommands(text) {
  const block = bashBlocks(text).find((lines) =>
    lines.some((line) => STARTER_MERGE.test(command(line))),
  );
  return block ? block.map(command) : null;
}

/** The merge and every command after it: what runs once `starter` is fetched. */
const fromMerge = (commands) =>
  commands.slice(commands.findIndex((c) => STARTER_MERGE.test(c)));

/** Why the suite skips in a fork. */
const NOT_THE_STARTER =
  "this tree's ledger is not the starter's, so there is no starter to rehearse forking";

const read = (rel) => readFileSync(path.join(repoRoot, rel), "utf8");
const inStarter = (() => {
  const { prefixes } = parseTagPrefix(read(LEDGER));
  return prefixes.length === 1 && prefixes[0].prefix === STARTER_PREFIX;
})();

/** A command's outcome: never a throw, so a case can say what failed. */
function run(cwd, file, args) {
  const r = spawnSync(file, args, {
    cwd,
    env: gitEnv,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: r.status,
    output: `$ ${[file, ...args].join(" ")}\n${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? String(r.error) : ""}`,
  };
}

/** `run`, without blocking: for the checks that may run side by side. */
function runAsync(cwd, file, args) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd, env: gitEnv, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          status: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          output: `$ ${[file, ...args].join(" ")}\n${stdout}${stderr}${error && typeof error.code !== "number" ? String(error) : ""}`,
        });
      },
    );
  });
}

/** Git in `cwd`, throwing on failure: the setup's own steps. */
const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8" });

function initIdentity(cwd) {
  git(cwd, "config", "user.name", "fork-rehearsal");
  git(cwd, "config", "user.email", "fork-rehearsal@example.invalid");
  git(cwd, "config", "commit.gpgsign", "false");
}

/** Copies the tree as it stands — tracked and untracked, never ignored. */
function copyTree(to) {
  const listed = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: repoRoot, env: gitEnv, encoding: "utf8" },
  );
  for (const rel of new Set(listed.split("\0").filter(Boolean))) {
    const from = path.join(repoRoot, rel);
    let stat;
    try {
      stat = lstatSync(from);
    } catch {
      continue; // deleted in the working tree
    }
    const target = path.join(to, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    if (stat.isSymbolicLink()) symlinkSync(readlinkSync(from), target);
    else if (stat.isFile()) copyFileSync(from, target);
  }
}

/**
 * The fork reads this tree's installed dependencies, never its own: the root's
 * `node_modules` and each workspace's, as symlinks. Git ignores them, so the
 * fork's tree stays clean, and the rename walks past them.
 */
function linkNodeModules(fork) {
  const workspaces = ["apps", "packages"].flatMap((dir) =>
    readdirSync(path.join(fork, dir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${dir}/${entry.name}`),
  );
  for (const rel of [".", ...workspaces]) {
    const installed = path.join(repoRoot, rel, "node_modules");
    if (existsSync(installed)) {
      symlinkSync(installed, path.join(fork, rel, "node_modules"), "dir");
    }
  }
}

/** Every journal file of a tree, by path, with its text. */
function journal(cwd) {
  const files = git(cwd, "ls-files", "docs/plan", CHANGELOG).trim().split("\n");
  return Object.fromEntries(
    files.map((rel) => [rel, readFileSync(path.join(cwd, rel), "utf8")]),
  );
}

/** The fork opens its first deliverable, as `/scope` would write it. */
function openFirstLane(fork) {
  const at = (rel) => path.join(fork, rel);
  const ledger = readFileSync(at(LEDGER), "utf8");
  const separator = ledger.match(/^\| -+ \|.*\|$/m);
  assert.ok(separator, "the bootstrapped ledger has no table");
  writeFileSync(
    at(LEDGER),
    ledger.replace(
      separator[0],
      `${separator[0]}\n| [D1](0001-first-feature.md) | First feature | **in progress** | The fork's first deliverable. |`,
    ),
  );
  writeFileSync(
    at(FORK_PLAN),
    `# D1 — First feature

- Status: **in progress** — opened 2026-10-02; **scoped in full 2026-10-01 by \`/scope\`**.
- Records: [ADR-0084](../adr/0084-fork-readiness.md), superseded in the fork's own corpus.
- Schema: no
- Tier: package
- Ledger: [\`docs/plan/README.md\`](README.md)
- Notes: [\`0001-first-feature.notes.md\`](0001-first-feature.notes.md)

## Goal

The fork's first deliverable.

## Steps

- [ ] **1. Build it.**
      **Done when:** its test is green.
`,
  );
  writeFileSync(
    at(FORK_NOTES),
    "# D1 — First feature: build notes\n\nThe fork's own journal.\n",
  );
  writeFileSync(
    at(FORK_LANE),
    `# Lane D1

- Deliverable: [D1](../0001-first-feature.md)
- Opened: 2026-10-02
- Branch: \`lane/D1\`
- Tier: package
- Schema: no
- Records: [0084](../../adr/0084-fork-readiness.md)
`,
  );
}

/**
 * The starter ships: the plan the fork deleted and its notes are edited, the
 * next lane opens with its plan, notes and lane file, the ledger gains its
 * row and the changelog an entry, and a file outside the journal changes.
 * Returns the edited plan and notes.
 */
function starterShips(starter) {
  const at = (rel) => path.join(starter, rel);
  const plans = git(starter, "ls-files", "docs/plan/[0-9]*.md")
    .trim()
    .split("\n")
    .filter(
      (rel) =>
        !rel.endsWith(".notes.md") &&
        existsSync(at(rel.replace(/\.md$/, ".notes.md"))),
    );
  assert.ok(plans.length > 0, "the starter has no plan with notes to edit");
  const plan = plans.at(-1);
  const notes = plan.replace(/\.md$/, ".notes.md");
  writeFileSync(at(plan), `${readFileSync(at(plan), "utf8")}\nShipped.\n`);
  writeFileSync(
    at(notes),
    `${readFileSync(at(notes), "utf8")}\n## Shipped\n\nThe ship's note.\n`,
  );
  const ledger = readFileSync(at(LEDGER), "utf8");
  const separator = ledger.match(/^\| -+ \|.*\|$/m);
  writeFileSync(
    at(LEDGER),
    ledger.replace(
      separator[0],
      `${separator[0]}\n| [D99](0099-rehearsal.md) | Rehearsal | **in progress** | The starter's next. |`,
    ),
  );
  writeFileSync(
    at(STARTER_PLAN),
    "# D99 — Rehearsal\n\n- Status: **in progress**\n- Tier: package\n",
  );
  writeFileSync(at(STARTER_NOTES), "# D99 — Rehearsal: build notes\n");
  writeFileSync(
    at(STARTER_LANE),
    "# Lane D99\n\n- Deliverable: [D99](../0099-rehearsal.md)\n- Opened: 2026-10-02\n- Branch: `lane/D99`\n- Tier: package\n- Schema: no\n- Records: [0084](../../adr/0084-fork-readiness.md)\n",
  );
  const changelog = readFileSync(at(CHANGELOG), "utf8");
  writeFileSync(
    at(CHANGELOG),
    `${changelog}\n## D98 — Rehearsed · 2026-10-02\n\nTag \`starter-D98\`.\n`,
  );
  mkdirSync(path.dirname(at(ARRIVES)), { recursive: true });
  writeFileSync(at(ARRIVES), "The starter's change reaches the fork.\n");
  git(starter, "add", "--all");
  git(starter, "commit", "--quiet", "-m", "the starter ships");
  return { plan, notes };
}

describe(
  "fork rehearsal",
  {
    skip: inStarter ? false : NOT_THE_STARTER,
  },
  () => {
    const forking = read("docs/forking.md");
    const upstreaming = read("docs/upstreaming.md");
    const documented = starterMergeCommands(forking);

    let tmp;
    let starter;
    let fork;
    /** What each stage produced, for the cases to read. */
    const seen = {};

    after(() => {
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    });

    before(
      async () => {
        assert.ok(documented, "docs/forking.md states no starter-merge block");
        tmp = mkdtempSync(path.join(os.tmpdir(), "fork-rehearsal-"));
        starter = path.join(tmp, "starter");
        fork = path.join(tmp, "fork");

        // 1. The starter: this tree as it stands, one commit.
        mkdirSync(starter);
        git(starter, "init", "--quiet", "--initial-branch=main");
        initIdentity(starter);
        copyTree(starter);
        git(starter, "add", "--all", "--force");
        git(starter, "commit", "--quiet", "-m", "the starter");
        const forkPoint = git(starter, "rev-parse", "HEAD").trim();

        // 2. The fork: a clone keeping history, bootstrapped and renamed.
        git(tmp, "clone", "--quiet", starter, fork);
        git(fork, "remote", "rename", "origin", "starter");
        initIdentity(fork);
        linkNodeModules(fork);
        seen.bootstrap = run(fork, process.execPath, [
          "scripts/bootstrap.mjs",
          "--prefix",
          PREFIX,
        ]);
        git(fork, "add", "--all");
        git(fork, "commit", "--quiet", "-m", "bootstrap the journal");
        seen.bootstrappedLedger = readFileSync(path.join(fork, LEDGER), "utf8");
        seen.bootstrappedPlans = git(fork, "ls-files", "docs/plan")
          .trim()
          .split("\n");
        seen.rename = run(fork, process.execPath, ["scripts/rename.mjs", NAME]);
        git(fork, "add", "--all");
        git(fork, "commit", "--quiet", "-m", `rename to ${NAME}`);

        seen.written = git(
          fork,
          "diff",
          "--name-only",
          "--no-renames",
          "--diff-filter=AM",
          forkPoint,
          "HEAD",
        )
          .trim()
          .split("\n")
          .filter((rel) => FORMATTED.test(rel));
        // The three checks read the tree and write nothing in it: side by
        // side, the rehearsal's longest wait is the slowest of them.
        [seen.formatCheck, seen.docsCheck, seen.scriptTests] =
          await Promise.all([
            runAsync(fork, process.execPath, [
              "node_modules/prettier/bin/prettier.cjs",
              "--check",
              ...seen.written,
            ]),
            runAsync(fork, process.execPath, ["scripts/docs-hygiene.mjs"]),
            runAsync(fork, process.execPath, [
              "--test",
              "--test-reporter=spec",
              "scripts/**/*.test.mjs",
            ]),
          ]);

        openFirstLane(fork);
        seen.lanes = run(fork, process.execPath, ["scripts/lanes.mjs"]);
        seen.openedDocsCheck = run(fork, process.execPath, [
          "scripts/docs-hygiene.mjs",
        ]);
        git(fork, "add", "--all");

        // 3. The starter ships.
        seen.shipped = starterShips(starter);

        // 4. The documented commands over the staged lane, where the merge
        //    refuses to start; then over the committed lane, and the commit §5
        //    describes.
        const runDocumented = () =>
          documented
            .filter((line) => !PLACEHOLDER.test(line))
            .map((line) => ({
              line,
              ...run(fork, "sh", ["-c", line]),
            }));
        const staged = () =>
          git(fork, "diff", "--cached", "--name-only", "--no-renames")
            .trim()
            .split("\n");
        seen.refusal = { head: git(fork, "rev-parse", "HEAD").trim() };
        seen.refusal.stagedBefore = staged();
        seen.refusal.commands = runDocumented();
        seen.refusal.headAfter = git(fork, "rev-parse", "HEAD").trim();
        seen.refusal.mergeStarted = existsSync(
          path.join(fork, ".git", "MERGE_HEAD"),
        );
        seen.refusal.stagedAfter = staged();

        git(fork, "add", "--all");
        git(fork, "commit", "--quiet", "-m", "open D1");
        seen.forkJournal = journal(fork);

        seen.commands = runDocumented();
        seen.mergeStopped = existsSync(path.join(fork, ".git", "MERGE_HEAD"));
        seen.unmerged = git(fork, "ls-files", "--unmerged");
        seen.commit = seen.mergeStopped
          ? run(fork, "git", ["commit", "--quiet", "--no-edit"])
          : run(fork, "git", [
              "commit",
              "--quiet",
              "-m",
              "remove the journal files the starter merge brought",
            ]);
        seen.mergedDocsCheck = run(fork, process.execPath, [
          "scripts/docs-hygiene.mjs",
        ]);
      },
      { timeout: 300_000 },
    );

    it("the bootstrapped fork passes docs:check and its script tests", () => {
      assert.equal(seen.bootstrap.status, 0, seen.bootstrap.output);
      assert.equal(seen.rename.status, 0, seen.rename.output);
      assert.equal(seen.docsCheck.status, 0, seen.docsCheck.output);
      assert.match(
        seen.docsCheck.output,
        new RegExp(`tag prefix: ${PREFIX}\\b`),
      );
      assert.equal(seen.scriptTests.status, 0, seen.scriptTests.output);
      assert.match(seen.scriptTests.output, /\bfail 0\b/);
      // The fork's own copy of this suite finds no starter and skips.
      assert.ok(
        seen.scriptTests.output.includes(`fork rehearsal`) &&
          seen.scriptTests.output.includes(`# ${NOT_THE_STARTER}`),
        seen.scriptTests.output,
      );

      // Every file bootstrap and rename wrote passes `format:check`.
      for (const rel of [LEDGER, CHANGELOG]) {
        assert.ok(seen.written.includes(rel), `${rel} was not rewritten`);
      }
      assert.equal(seen.formatCheck.status, 0, seen.formatCheck.output);

      // And its first lane opens on the bootstrapped ledger.
      assert.equal(seen.lanes.status, 0, seen.lanes.output);
      assert.equal(seen.openedDocsCheck.status, 0, seen.openedDocsCheck.output);
    });

    it("the bootstrapped fork's /scope preconditions hold: a prefix, an empty ledger, the generated block", () => {
      const ledger = seen.bootstrappedLedger;
      // A prefix: the one header line `/ship` tags from, and not the starter's.
      const { prefixes } = parseTagPrefix(ledger);
      assert.deepEqual(
        prefixes.map(({ prefix }) => prefix),
        [PREFIX],
      );
      // An empty ledger: the table's header and separator, and no row for
      // `/scope` to find — it writes the first one.
      const lines = ledger.split("\n");
      const header = lines.findIndex((line) => /^\|\s*#\s*\|/.test(line));
      assert.notEqual(header, -1, "the ledger has no table");
      assert.match(lines[header + 1], /^\|\s*-+/);
      assert.ok(
        !/^\|/.test(lines[header + 2] ?? ""),
        `the ledger has a row: ${lines[header + 2]}`,
      );
      // No plan is left for `/scope` to trip on; the ledger and the lanes'
      // README are the whole of docs/plan/.
      assert.deepEqual(
        [...seen.bootstrappedPlans].sort(),
        [LEDGER, `${LANES_DIR}/README.md`].sort(),
      );
      // The generated block, reading no lane open, under the window section
      // every rule file links to.
      assert.match(ledger, /^## The window$/m);
      const block = findBlock(ledger);
      assert.ok(block && !block.error, "the ledger has no generated block");
      assert.equal(block.block, renderLanes([]));
      assert.ok(
        ledger.indexOf("## The window") < block.start,
        "the generated block is not in the window section",
      );
    });

    it("a starter ship that edits a plan the fork deleted merges with the documented commands", () => {
      const merge = seen.commands.find(({ line }) => STARTER_MERGE.test(line));
      assert.ok(merge, "the rehearsal ran no starter merge");
      // The merge stops at every ship: `/ship` edits a plan the fork deleted.
      assert.notEqual(merge.status, 0, merge.output);
      assert.match(
        merge.output,
        new RegExp(
          `CONFLICT \\(modify/delete\\): ${seen.shipped.plan.replaceAll(".", "\\.")} deleted in HEAD`,
        ),
      );
      assert.ok(seen.mergeStopped, "the merge did not stop");
      for (const ran of seen.commands) {
        if (ran !== merge) assert.equal(ran.status, 0, ran.output);
      }
      assert.equal(seen.unmerged, "", "a conflict is left after the commands");
      assert.equal(seen.commit.status, 0, seen.commit.output);
      assert.equal(
        git(fork, "rev-list", "--parents", "-n", "1", "HEAD").trim().split(" ")
          .length,
        3,
        "HEAD is not the merge's commit",
      );
      assert.equal(git(fork, "status", "--porcelain"), "");
      assert.equal(
        readFileSync(path.join(fork, ARRIVES), "utf8"),
        "The starter's change reaches the fork.\n",
      );
    });

    it("the starter's added plans, notes and lane files are gone after the documented commands", () => {
      const tracked = git(fork, "ls-files", "docs/plan").trim().split("\n");
      for (const rel of [
        STARTER_PLAN,
        STARTER_NOTES,
        STARTER_LANE,
        seen.shipped.plan,
        seen.shipped.notes,
      ]) {
        assert.ok(!tracked.includes(rel), `${rel} is in the fork's journal`);
        assert.ok(!existsSync(path.join(fork, rel)), `${rel} is on disk`);
      }
      assert.deepEqual(
        tracked,
        Object.keys(seen.forkJournal).filter((rel) => rel !== CHANGELOG),
      );
    });

    it("the fork's ledger, changelog and notes are unchanged by the merge", () => {
      assert.ok(FORK_NOTES in seen.forkJournal);
      assert.ok(FORK_LANE in seen.forkJournal);
      assert.deepEqual(journal(fork), seen.forkJournal);
    });

    it("a fork's staged plan survives a merge that refuses to start", () => {
      const merge = seen.refusal.commands.find(({ line }) =>
        STARTER_MERGE.test(line),
      );
      assert.ok(merge, "the rehearsal ran no starter merge");
      assert.notEqual(merge.status, 0, merge.output);
      assert.ok(!seen.refusal.mergeStarted, "the merge started");
      assert.equal(seen.refusal.headAfter, seen.refusal.head);
      for (const ran of seen.refusal.commands) {
        if (ran !== merge) assert.equal(ran.status, 0, ran.output);
      }
      for (const rel of [FORK_PLAN, FORK_NOTES, FORK_LANE]) {
        assert.ok(seen.refusal.stagedBefore.includes(rel), `${rel} not staged`);
        assert.ok(
          seen.refusal.stagedAfter.includes(rel),
          `${rel} was unstaged by the command after the merge`,
        );
      }
      assert.deepEqual(seen.refusal.stagedAfter, seen.refusal.stagedBefore);
    });

    it("the fork passes docs:check after the merge", () => {
      assert.equal(seen.mergedDocsCheck.status, 0, seen.mergedDocsCheck.output);
      assert.match(
        seen.mergedDocsCheck.output,
        new RegExp(`tag prefix: ${PREFIX}\\b`),
      );
    });

    it("upstreaming.md's merge-down runs the same commands as forking.md", () => {
      const down = starterMergeCommands(upstreaming);
      assert.ok(down, "docs/upstreaming.md states no starter-merge block");
      assert.deepEqual(fromMerge(down), fromMerge(documented));
      assert.ok(
        down
          .slice(
            0,
            down.findIndex((c) => STARTER_MERGE.test(c)),
          )
          .some((c) => /^git fetch starter\b/.test(c)),
        "docs/upstreaming.md merges without fetching the starter first",
      );
    });
  },
);
