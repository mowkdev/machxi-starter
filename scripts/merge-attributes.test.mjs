// The journal's merge attributes (ADR-0082 §4, shared surfaces that do not
// conflict; ADR-0065 §3 as carried, the journal a fork keeps). Each case builds
// a temporary repository under the OS temp directory, carrying this clone's own
// `.gitattributes`, and runs a real merge in it. Git reads no global or system
// config here, so a `merge.ours.driver` defined on the machine cannot make a
// case pass: the only driver any case sees is the one its command line defines.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const attributes = readFileSync(path.join(repoRoot, ".gitattributes"), "utf8");

/**
 * The starter merge, as `docs/forking.md` states it: the drivers it defines on
 * its own command line, and nothing else. `/bootstrap` must say the same.
 */
const STARTER_MERGE =
  /git((?: -c merge\.[a-z]+\.driver=true)+) merge starter\/main/;

const forking = readFileSync(path.join(repoRoot, "docs/forking.md"), "utf8");
const starterMerge = forking.match(STARTER_MERGE);
const starterMergeConfig = starterMerge
  ? starterMerge[1]
      .trim()
      .split(/\s+/)
      .filter((part) => part !== "-c")
  : [];

/**
 * The step after the starter merge, as `docs/forking.md` states it: every lane
 * file the merge added is removed (ADR-0082 §4). A lane file is a new file, and
 * a merge takes a file added on one side without consulting any driver.
 */
const DROP_LANES =
  /^git diff --name-only --diff-filter=A ORIG_HEAD -- '[^']+' \| xargs -r git rm -q$/m;
const dropLanes = forking.match(DROP_LANES)?.[0];

/** Git with no global or system config, and nothing but what a case passes. */
const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};

const repos = [];

after(() => {
  for (const dir of repos) rmSync(dir, { recursive: true, force: true });
});

/** A fresh repository on `main` with this clone's `.gitattributes` committed. */
function repository() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "merge-attributes-"));
  repos.push(dir);
  const git = (...args) =>
    execFileSync("git", args, { cwd: dir, env: gitEnv, encoding: "utf8" });
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.name", "merge-attributes");
  git("config", "user.email", "merge-attributes@example.invalid");
  git("config", "commit.gpgsign", "false");
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  };
  const read = (file) => readFileSync(path.join(dir, file), "utf8");
  const commit = (message, files) => {
    for (const [file, text] of Object.entries(files)) write(file, text);
    git("add", "--all");
    git("commit", "--quiet", "-m", message);
  };
  /** A merge that may fail: its exit status, never a throw. */
  const merge = (config, branch) =>
    spawnSync(
      "git",
      [
        ...config.flatMap((entry) => ["-c", entry]),
        "merge",
        "--no-edit",
        branch,
      ],
      { cwd: dir, env: gitEnv, encoding: "utf8" },
    );
  write(".gitattributes", attributes);
  return { dir, git, read, commit, merge };
}

const NOTES = "docs/plan/0099-example.notes.md";
const LEDGER = "docs/plan/README.md";
const CHANGELOG = "docs/CHANGELOG.md";

const notesBase = "# D99 — build notes\n\nThe journal of D99.\n";
const changelogBase =
  "# Changelog\n\nOne entry per shipped deliverable.\n\n## D1 — First · 2026-01-01\n\nTag `starter-D1`.\n";
const ledgerBase =
  "# Deliverables\n\n| # | Title | Status |\n| --- | --- | --- |\n| D1 | First | shipped |\n| D2 | Second | planned |\n";

/** A changelog with one more entry at the top, where `/ship` writes it. */
const withEntry = (text, entry) =>
  text.replace(
    "\n## ",
    `\n## ${entry} · 2026-02-01\n\nTag \`starter-${entry.split(" ")[0]}\`.\n\n## `,
  );

describe("merge attributes", () => {
  it("the journal names ours, the notes and the changelog union", () => {
    const repo = repository();
    repo.commit("base", {
      [NOTES]: notesBase,
      [LEDGER]: ledgerBase,
      [CHANGELOG]: changelogBase,
    });
    const out = repo.git(
      "check-attr",
      "merge",
      LEDGER,
      "docs/plan/0099-example.md",
      NOTES,
      CHANGELOG,
    );
    assert.equal(
      out,
      [
        `${LEDGER}: merge: ours`,
        "docs/plan/0099-example.md: merge: ours",
        `${NOTES}: merge: union`,
        `${CHANGELOG}: merge: union`,
        "",
      ].join("\n"),
    );
  });

  it("a lane merge keeps both sides of a notes file", () => {
    const repo = repository();
    repo.commit("base", { [NOTES]: notesBase });
    repo.git("checkout", "--quiet", "-b", "lane/D98");
    repo.commit("lane", {
      [NOTES]: `${notesBase}\n## D99.2 — the lane's step\n\nBuilt on the lane.\n`,
    });
    repo.git("checkout", "--quiet", "main");
    repo.commit("main", {
      [NOTES]: `${notesBase}\n## D99.1 — main's step\n\nBuilt on main.\n`,
    });

    const result = repo.merge([], "lane/D98");

    assert.equal(result.status, 0, result.stdout + result.stderr);
    const notes = repo.read(NOTES);
    assert.match(notes, /## D99\.1 — main's step\n\nBuilt on main\./);
    assert.match(notes, /## D99\.2 — the lane's step\n\nBuilt on the lane\./);
    assert.doesNotMatch(notes, /^(<<<<<<<|=======|>>>>>>>)/m);
  });

  it("a lane merge keeps both sides of the changelog", () => {
    const repo = repository();
    repo.commit("base", { [CHANGELOG]: changelogBase });
    repo.git("checkout", "--quiet", "-b", "lane/D3");
    repo.commit("lane", {
      [CHANGELOG]: withEntry(changelogBase, "D3 — Third"),
    });
    repo.git("checkout", "--quiet", "main");
    repo.commit("main", {
      [CHANGELOG]: withEntry(changelogBase, "D2 — Second"),
    });

    const result = repo.merge([], "lane/D3");

    assert.equal(result.status, 0, result.stdout + result.stderr);
    const changelog = repo.read(CHANGELOG);
    assert.match(
      changelog,
      /## D2 — Second · 2026-02-01\n\nTag `starter-D2`\./,
    );
    assert.match(changelog, /## D3 — Third · 2026-02-01\n\nTag `starter-D3`\./);
    assert.match(changelog, /## D1 — First · 2026-01-01/);
    assert.doesNotMatch(changelog, /^(<<<<<<<|=======|>>>>>>>)/m);
  });

  it("a union driver defined in the clone makes a lane merge drop a side", () => {
    // Why no clone may keep the starter merge's flags in its config.
    const repo = repository();
    repo.git("config", "merge.union.driver", "true");
    repo.commit("base", { [CHANGELOG]: changelogBase });
    repo.git("checkout", "--quiet", "-b", "lane/D3");
    repo.commit("lane", {
      [CHANGELOG]: withEntry(changelogBase, "D3 — Third"),
    });
    repo.git("checkout", "--quiet", "main");
    repo.commit("main", {
      [CHANGELOG]: withEntry(changelogBase, "D2 — Second"),
    });

    const result = repo.merge([], "lane/D3");

    assert.equal(result.status, 0, result.stdout + result.stderr);
    const changelog = repo.read(CHANGELOG);
    assert.match(changelog, /## D2 — Second/);
    assert.doesNotMatch(changelog, /## D3 — Third/);
  });

  it("a lane merge of the ledger conflicts rather than dropping a side", () => {
    const repo = repository();
    repo.commit("base", { [LEDGER]: ledgerBase });
    repo.git("checkout", "--quiet", "-b", "lane/D2");
    repo.commit("lane", {
      [LEDGER]: ledgerBase.replace(
        "| D2 | Second | planned |",
        "| D2 | Second | in progress |",
      ),
    });
    repo.git("checkout", "--quiet", "main");
    repo.commit("main", {
      [LEDGER]: ledgerBase.replace(
        "| D2 | Second | planned |",
        "| D2 | Second | shipped |",
      ),
    });

    const result = repo.merge([], "lane/D2");

    assert.notEqual(result.status, 0, "the ledger merged without a conflict");
    assert.match(
      result.stdout,
      /CONFLICT \(content\): Merge conflict in docs\/plan\/README\.md/,
    );
    const ledger = repo.read(LEDGER);
    assert.match(ledger, /^<<<<<<< /m);
    assert.match(ledger, /\| D2 \| Second \| shipped \|/);
    assert.match(ledger, /\| D2 \| Second \| in progress \|/);
  });

  it("the starter merge with the driver on the command line keeps ours", () => {
    // `docs/forking.md` states the command, and `/bootstrap` repeats it.
    assert.ok(
      starterMerge,
      "docs/forking.md states no `git -c merge.<driver>.driver=true … merge starter/main`",
    );
    assert.deepEqual(starterMergeConfig, [
      "merge.ours.driver=true",
      "merge.union.driver=true",
    ]);
    const bootstrap = readFileSync(
      path.join(repoRoot, ".claude/skills/bootstrap/SKILL.md"),
      "utf8",
    );
    assert.ok(
      bootstrap.includes(starterMerge[0]),
      `/bootstrap does not name \`${starterMerge[0]}\``,
    );

    // The starter at the fork point, then each side's own journal: the fork
    // resets its ledger, changelog and notes; the starter ships another
    // deliverable and changes code the fork wants.
    const repo = repository();
    const code = "export const answer = 41;\n";
    repo.commit("the starter at the fork point", {
      [LEDGER]: ledgerBase,
      [CHANGELOG]: changelogBase,
      [NOTES]: notesBase,
      "src/answer.ts": code,
    });
    repo.git("checkout", "--quiet", "-b", "starter");
    repo.commit("the starter ships D2", {
      [LEDGER]: ledgerBase.replace(
        "| D2 | Second | planned |",
        "| D2 | Second | shipped |",
      ),
      [CHANGELOG]: withEntry(changelogBase, "D2 — Second"),
      [NOTES]: `${notesBase}\n## D99.1 — the starter's step\n`,
      "src/answer.ts": "export const answer = 42;\n",
    });
    repo.git("checkout", "--quiet", "main");
    const forkLedger =
      "# Deliverables\n\nTag prefix: `acme`\n\n| # | Title | Status |\n| --- | --- | --- |\n| S1 | Fork's first | in progress |\n";
    const forkChangelog =
      "# Changelog\n\nOne entry per shipped deliverable of acme.\n";
    const forkNotes = "# D99 — build notes\n\nThe fork's own journal.\n";
    repo.commit("the fork resets its journal", {
      [LEDGER]: forkLedger,
      [CHANGELOG]: forkChangelog,
      [NOTES]: forkNotes,
    });

    // Without the drivers the journal meets the starter's: that is the point.
    const bare = repo.merge([], "starter");
    assert.notEqual(bare.status, 0, "the ledger merged without the drivers");
    repo.git("merge", "--abort");

    const result = repo.merge(starterMergeConfig, "starter");

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(repo.read(LEDGER), forkLedger);
    assert.equal(repo.read(CHANGELOG), forkChangelog);
    assert.equal(repo.read(NOTES), forkNotes);
    assert.equal(repo.read("src/answer.ts"), "export const answer = 42;\n");
  });

  it("a starter merge adds the starter's lane file, which the documented step removes", () => {
    assert.ok(
      dropLanes,
      "docs/forking.md states no step that removes the lane files the starter merge adds",
    );
    const bootstrap = readFileSync(
      path.join(repoRoot, ".claude/skills/bootstrap/SKILL.md"),
      "utf8",
    );
    assert.ok(
      bootstrap.includes(dropLanes),
      `/bootstrap does not name \`${dropLanes}\``,
    );

    const LANES_README = "docs/plan/lanes/README.md";
    const repo = repository();
    repo.commit("the starter at the fork point", {
      [LEDGER]: ledgerBase,
      [LANES_README]: "# Lanes\n\nOne file per open lane.\n",
    });
    repo.git("checkout", "--quiet", "-b", "starter");
    repo.commit("the starter opens D40", {
      [LEDGER]: ledgerBase.replace(
        "| D2 | Second | planned |",
        "| D2 | Second | planned |\n| D40 | Forty | in progress |",
      ),
      "docs/plan/lanes/D40.md":
        "# Lane D40\n\n- Deliverable: [D40](../0040-x.md)\n",
      "src/answer.ts": "export const answer = 42;\n",
    });
    repo.git("checkout", "--quiet", "main");
    const forkLedger =
      "# Deliverables\n\n| # | Title | Status |\n| --- | --- | --- |\n| D1 | Fork's first | in progress |\n";
    const forkLane = "# Lane D1\n\n- Deliverable: [D1](../0001-x.md)\n";
    repo.commit("the fork resets its journal and opens its first lane", {
      [LEDGER]: forkLedger,
      "docs/plan/lanes/D1.md": forkLane,
    });

    const result = repo.merge(starterMergeConfig, "starter");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    // The attributes kept the fork's ledger, and could not keep the file out.
    assert.equal(repo.read(LEDGER), forkLedger);
    assert.match(repo.git("ls-files", "docs/plan/lanes"), /D40\.md/);

    execFileSync("sh", ["-c", dropLanes], { cwd: repo.dir, env: gitEnv });
    repo.git("commit", "--quiet", "-m", "drop the starter's open lanes");

    assert.deepEqual(
      repo.git("ls-files", "docs/plan/lanes").trim().split("\n"),
      ["docs/plan/lanes/D1.md", LANES_README],
    );
    assert.equal(repo.read("docs/plan/lanes/D1.md"), forkLane);
    assert.equal(repo.read("src/answer.ts"), "export const answer = 42;\n");
  });
});
