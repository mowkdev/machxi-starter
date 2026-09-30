// `pnpm bootstrap`'s journal reset (ADR-0084 §1). Each case builds a
// starter-shaped clone under the OS temp directory — a ledger with rows, lanes
// and a frozen history section, plans, notes, lane files and a changelog with
// entries — and bootstraps it. Nothing here reads this repository's own
// journal, so the cases pass unchanged in a fork whose journal is its own; the
// rehearsal (`scripts/fork-rehearsal.test.mjs`) runs the script over the real
// tree. Git reads no global or system config.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import * as prettier from "prettier";

import {
  BootstrapRefusal,
  anchorOf,
  bootstrap,
  parseArgs,
  prefixProblem,
} from "./bootstrap.mjs";
import {
  checkLanes,
  parseTagPrefix,
  scanCloseOut,
  scanLanes,
  scanTagPrefix,
  scanUnionJournal,
} from "./docs-hygiene.mjs";
import { findBlock, parseLaneFile, renderLanes } from "./lanes.mjs";

const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};

const LANE_FILE = `# Lane D9

- Deliverable: [D9](../0009-second.md)
- Opened: 2026-01-02
- Branch: \`lane/D9\`
- Tier: package
- Schema: no
- Records: [0002](../../adr/0002-second.md)
`;

const LEDGER = `# Deliverables

The ledger of staged work in this repository. A **deliverable** is the unit of staged work.

Tag prefix: \`starter\`

\`/ship\` tags each shipped deliverable \`<prefix>-D<n>\` from the line above.

| #                     | Title  | Status                 | Scope in one line |
| --------------------- | ------ | ---------------------- | ----------------- |
| [D8](0008-first.md)   | First  | **shipped 2026-01-01** | The first.        |
| [D9](0009-second.md)  | Second | **in progress**        | The second.       |

## Rules

- **Steps are written \`D<n>.<step>\`.** [The window](#the-window) names every open lane.
- **A rule, bold.** Then a note on [D8](0008-first.md).

## The window

**One place to be right.** This section states the open lanes. [The history after this section](#the-windows-history-frozen-at-d344) is a record of earlier states.

The starter's own story is told in [the frozen history](#the-windows-history-frozen-at-d344).

- **The narrative** is in the \`How D<n>\` sections. The paragraph below states what the lane files say. Until \`D34.4\` it was written by hand; that paragraph is kept in [a section of its own](#the-windows-history-frozen-at-d344), and is never edited again.
- D8 shipped as [its plan](0008-first.md) says, on the evidence in [How D8 closed](#how-d8-closed).

**Open lanes:**

${renderLanes([parseLaneFile("D9.md", LANE_FILE).lane])}

## The window's history, frozen at D34.4

**One lane is open, D34.** The starter's own history.

## Executing a step

\`/step\` builds the next step.

## How D8 closed

On the evidence of [the plan](0008-first.md).
`;

const CHANGELOG = `# Changelog

One entry per **shipped deliverable**. Not per commit, and not semver: every entry from the deliverable that decided this on carries an annotated tag \`<prefix>-D<n>\` on its shipping commit, the prefix named in the ledger's header — \`starter\` here — and the entries below that point predate it ([ADR-0065](adr/0065-starter-lifecycle.md) §2).

**This file is journal, like [\`plan/\`](plan/README.md).** \`/bootstrap\` resets it to this preamble with the fork's own prefix.

## D9 — Second · 2026-01-02

The second. Tag \`starter-D9\`.

## D8 — First · 2026-01-01

The first.
`;

const STARTER = {
  "docs/plan/README.md": LEDGER,
  "docs/plan/lanes/README.md": "# Open lanes\n\nOne file per open lane.\n",
  "docs/plan/lanes/D9.md": LANE_FILE,
  "docs/plan/0008-first.md":
    "# D8 — First\n\n- Status: **shipped 2026-01-01**\n- Tier: package\n",
  "docs/plan/0008-first.notes.md": "# D8 — First: build notes\n",
  "docs/plan/0009-second.md":
    "# D9 — Second\n\n- Status: in progress\n- Tier: package\n",
  "docs/plan/0009-second.notes.md": "# D9 — Second: build notes\n",
  "docs/CHANGELOG.md": CHANGELOG,
  "docs/adr/0002-second.md": "# ADR-0002: Second\n\n- Status: accepted\n",
  "README.md": "# A starter\n",
};

const dirs = [];

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A committed starter-shaped clone under the OS temp directory. */
function clone(files = STARTER, { git: withGit = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "bootstrap-"));
  dirs.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, env: gitEnv, encoding: "utf8" });
  if (withGit) {
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.name", "bootstrap");
    git("config", "user.email", "bootstrap@example.invalid");
    git("config", "commit.gpgsign", "false");
    git("add", "--all");
    git("commit", "--quiet", "-m", "the starter");
  }
  const read = (rel) => readFileSync(path.join(root, rel), "utf8");
  return { root, git, read };
}

/** Every file under `dir`, as paths relative to `root`, sorted. */
function tree(root, dir = "docs") {
  const out = [];
  const walk = (rel) => {
    for (const entry of readdirSync(path.join(root, rel), {
      withFileTypes: true,
    })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else out.push(child);
    }
  };
  walk(dir);
  return out.sort();
}

/** The contents of every file under `docs/`, to prove a refusal wrote nothing. */
const snapshot = (root) =>
  Object.fromEntries(
    tree(root).map((rel) => [rel, readFileSync(path.join(root, rel), "utf8")]),
  );

const run = (root, prefix = "acme") => bootstrap({ root, prefix, env: gitEnv });

describe("bootstrap", () => {
  it("a fresh clone bootstraps to an empty ledger under the given prefix", async () => {
    const { root, read } = clone();
    await run(root);
    const ledger = read("docs/plan/README.md");

    assert.deepEqual(
      parseTagPrefix(ledger).prefixes.map((p) => p.prefix),
      ["acme"],
    );
    // The table's header and delimiter, and no row.
    const table = ledger.split("\n").filter((l) => l.startsWith("|"));
    assert.deepEqual(table, [
      "| #   | Title | Status | Scope in one line |",
      "| --- | ----- | ------ | ----------------- |",
    ]);
    assert.deepEqual(
      ledger.split("\n").filter((l) => /^##? /.test(l)),
      ["# Deliverables", "## Rules", "## The window"],
    );
    // The rules and the window's own prose are the starter's.
    assert.match(ledger, /\*\*Steps are written `D<n>\.<step>`\.\*\*/);
    assert.match(ledger, /\*\*One place to be right\.\*\*/);

    // The fork's checks read it clean.
    assert.deepEqual((await scanLanes(root)).violations, []);
    assert.deepEqual(await scanTagPrefix(root), {
      violations: [],
      prefix: "acme",
    });
    assert.deepEqual(await scanUnionJournal(root), []);
    assert.deepEqual(await scanCloseOut(root), { violations: [], exempt: 0 });

    // And `format:check` would: both rewritten files are as Prettier writes them.
    for (const rel of ["docs/plan/README.md", "docs/CHANGELOG.md"]) {
      assert.ok(
        await prettier.check(read(rel), { filepath: path.join(root, rel) }),
        `${rel} is formatted`,
      );
    }
  });

  it("the starter's plans, notes and lane files are removed and lanes/README.md is kept", async () => {
    const { root, read } = clone();
    const { removed } = await run(root);

    assert.deepEqual(tree(root, "docs/plan"), [
      "docs/plan/README.md",
      "docs/plan/lanes/README.md",
    ]);
    assert.deepEqual(removed, [
      "docs/plan/0008-first.md",
      "docs/plan/0008-first.notes.md",
      "docs/plan/0009-second.md",
      "docs/plan/0009-second.notes.md",
      "docs/plan/lanes/D9.md",
    ]);
    assert.equal(
      read("docs/plan/lanes/README.md"),
      STARTER["docs/plan/lanes/README.md"],
    );
    // The carried corpus is untouched.
    assert.equal(
      read("docs/adr/0002-second.md"),
      STARTER["docs/adr/0002-second.md"],
    );
  });

  it("the ledger carries no link to the frozen history", async () => {
    const { root, read } = clone();
    await run(root);
    const ledger = read("docs/plan/README.md");

    assert.doesNotMatch(ledger, /frozen|history after this section/i);
    assert.doesNotMatch(ledger, /D34\.4/);
    // No link to a plan the reset removed.
    assert.doesNotMatch(ledger, /\]\(\d{4}-[^)]*\.md\)/);
    // Every in-page link names a heading the ledger has.
    const anchors = new Set(
      ledger
        .split("\n")
        .filter((l) => /^#{1,6} /.test(l))
        .map(anchorOf),
    );
    const links = [...ledger.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
    assert.ok(links.includes("the-window"));
    for (const link of links) assert.ok(anchors.has(link), link);
    // A sentence that linked nothing dropped stays.
    assert.match(
      ledger,
      /\*\*The narrative\*\* is in the `How D<n>` sections\. The paragraph below states what the lane files say\.\n/,
    );
    assert.match(ledger, /This section states the open lanes\.\n/);
  });

  it("the changelog is its preamble under the fork's prefix", async () => {
    const { root, read } = clone();
    await run(root);

    assert.equal(
      read("docs/CHANGELOG.md"),
      `# Changelog

One entry per **shipped deliverable**. Not per commit, and not semver: every entry carries an annotated tag \`<prefix>-D<n>\` on its shipping commit, the prefix named in the ledger's header — \`acme\` here ([ADR-0065](adr/0065-starter-lifecycle.md) §2).

**This file is journal, like [\`plan/\`](plan/README.md).** \`/bootstrap\` resets it to this preamble with the fork's own prefix.
`,
    );
  });

  it("the generated block reads no lane open", async () => {
    const { root, read } = clone();
    await run(root);
    const ledger = read("docs/plan/README.md");

    assert.equal(findBlock(ledger).block, renderLanes([]));
    assert.match(findBlock(ledger).block, /\*\*No lane is open\.\*\*/);
    assert.deepEqual(
      checkLanes({ ledger, laneFiles: [], readPlan: () => null }),
      [],
    );
  });

  it("a bold rule before a dropped link is kept", async () => {
    const { root, read } = clone();
    await run(root);
    const ledger = read("docs/plan/README.md");

    assert.match(ledger, /^- \*\*A rule, bold\.\*\*$/m);
    assert.doesNotMatch(ledger, /Then a note on/);

    // A link inside the bold sentence itself is refused, not dropped with it.
    const inRule = clone({
      ...STARTER,
      "docs/plan/README.md": LEDGER.replace(
        "- **A rule, bold.** Then",
        "- **A rule on [D8](0008-first.md).** Then",
      ),
    });
    await assert.rejects(run(inRule.root), /from a bold rule/);
  });

  it("a paragraph dropped whole leaves the ledger as Prettier writes it", async () => {
    const { root, read } = clone();
    await run(root);
    const ledger = read("docs/plan/README.md");

    assert.doesNotMatch(ledger, /The starter's own story/);
    assert.doesNotMatch(ledger, /\n\n\n/);
    assert.ok(
      await prettier.check(ledger, {
        filepath: path.join(root, "docs/plan/README.md"),
      }),
    );
  });

  it("a ledger section bootstrap does not know is refused, not dropped", async () => {
    const section = clone({
      ...STARTER,
      "docs/plan/README.md": LEDGER.replace(
        "## The window\n",
        "## Numbering\n\nRecords are numbered in order.\n\n## The window\n",
      ),
    });
    await assert.rejects(run(section.root), /does not know, `## Numbering`/);

    const note = clone({
      ...STARTER,
      "docs/plan/README.md": LEDGER.replace(
        "\n## Rules\n",
        "\nA note under the table.\n\n## Rules\n",
      ),
    });
    await assert.rejects(
      run(note.root),
      /between its table and its first section/,
    );

    const twice = clone({
      ...STARTER,
      "docs/plan/README.md": LEDGER.replace(
        "## Executing a step\n",
        "## Rules\n\n- **Another.**\n\n## Executing a step\n",
      ),
    });
    await assert.rejects(run(twice.root), /`## Rules` twice/);
  });

  it("a tree that is not a fresh starter clone is refused", async () => {
    const refused = async (root, pattern, prefix = "acme") => {
      const before = snapshot(root);
      await assert.rejects(run(root, prefix), (error) => {
        assert.ok(error instanceof BootstrapRefusal, error);
        assert.match(error.message, pattern);
        return true;
      });
      assert.deepEqual(snapshot(root), before, "a refusal writes nothing");
    };

    // Bootstrapped already: the ledger names the fork's prefix.
    const done = clone();
    await run(done.root);
    done.git("add", "--all");
    done.git("commit", "--quiet", "-m", "bootstrap");
    await refused(done.root, /tag prefix is `acme`, not `starter`/, "other");

    // A dirty tree.
    const dirty = clone();
    writeFileSync(path.join(dirty.root, "README.md"), "# edited\n");
    await refused(dirty.root, /not clean/);

    // No clone at all.
    await refused(clone(STARTER, { git: false }).root, /not a git work tree/);

    // A journal missing a part the reset rewrites.
    const { "docs/plan/lanes/README.md": _, ...noLanes } = STARTER;
    await refused(clone(noLanes).root, /lanes\/README\.md is missing/);
    const noWindow = clone({
      ...STARTER,
      "docs/plan/README.md": LEDGER.replace(
        "## The window\n",
        "## How D0 closed\n",
      ),
    });
    await refused(noWindow.root, /has no `## The window`/);
    const reworded = clone({
      ...STARTER,
      "docs/CHANGELOG.md": CHANGELOG.replace("predate it", "came first"),
    });
    await refused(reworded.root, /preamble does not read/);

    // A prefix the ledger could not carry, or the starter's own.
    const fresh = clone();
    await refused(fresh.root, /starter's namespace/, "starter");
    await refused(fresh.root, /not a tag prefix/, "v2");
    await refused(fresh.root, /not a tag prefix/, "Acme");
    await refused(fresh.root, /name the fork's tag prefix/, "");
  });
});

describe("the command line", () => {
  it("takes the prefix either way and refuses anything else", () => {
    assert.deepEqual(parseArgs(["--prefix", "acme"]), { prefix: "acme" });
    assert.deepEqual(parseArgs(["--prefix=acme"]), { prefix: "acme" });
    assert.throws(() => parseArgs(["acme"]), /unknown argument/);
    assert.throws(() => parseArgs(["--prefx", "acme"]), /unknown argument/);
  });

  it("a prefix is the ledger's grammar and never the starter's", () => {
    assert.equal(prefixProblem("acme"), null);
    assert.equal(prefixProblem("acme-2"), null);
    assert.match(prefixProblem("starter"), /starter's namespace/);
    assert.match(prefixProblem("v1"), /not a tag prefix/);
    assert.match(prefixProblem("-acme"), /not a tag prefix/);
  });
});
