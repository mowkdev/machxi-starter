import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  LEDGER_WINDOW,
  checkSpec,
  checkText,
  inheritedDocuments,
  isExcluded,
  scan,
  scanSpecs,
  specDocuments,
} from "./docs-hygiene.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("CLAUDE.md stays under 6 KB", async () => {
  // Every session pays for this file. It carries rules, commands, the repo map,
  // search and workflow — no window history and no supersession chronology.
  const { size } = await stat(path.join(repoRoot, "CLAUDE.md"));
  assert.ok(size < 6 * 1024, `CLAUDE.md is ${size} bytes`);
});

const rules = (violations) => violations.map((v) => v.rule);

test("the documents a fork inherits are clean", async () => {
  const violations = await scan();
  assert.deepEqual(
    violations.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.found}`),
    [],
  );
});

test("the scan covers .claude/** and the always-loaded summary", async () => {
  const files = (await inheritedDocuments()).map((f) => f.rel);
  assert.ok(files.includes("CLAUDE.md"));
  assert.ok(files.includes(".claude/README.md"));
  assert.ok(files.some((f) => f.startsWith(".claude/rules/")));
  assert.ok(files.some((f) => f.startsWith(".claude/agents/")));
  assert.ok(files.some((f) => f.startsWith(".claude/skills/")));
});

test("the scan skips a git worktree parked under .claude", async () => {
  // `.claude/worktrees/` holds a second checkout of this repository, untracked
  // and often mid-step on another branch. Scanned, its documents are read as
  // somebody else's biography and redden this check for every session in the
  // tree over files git does not track. The prefix must be a path segment: a
  // file whose name merely starts with the same letters is still scanned.
  assert.ok(isExcluded(".claude/worktrees"));
  assert.ok(isExcluded(".claude/worktrees/specs/CLAUDE.md"));
  assert.ok(!isExcluded(".claude/worktrees-and-why.md"));
  assert.ok(!isExcluded(".claude/README.md"));

  // Over a fixture rather than this tree: the directory is gitignored, so on
  // CI and in a fresh clone it does not exist and an assertion about the real
  // walk would pass by finding nothing.
  const root = await mkdtemp(path.join(tmpdir(), "docs-hygiene-"));
  await mkdir(path.join(root, ".claude", "worktrees", "specs"), {
    recursive: true,
  });
  await writeFile(path.join(root, "CLAUDE.md"), "# fixture\n");
  await writeFile(path.join(root, ".claude", "README.md"), "# fixture\n");
  await writeFile(
    path.join(root, ".claude", "worktrees", "specs", "CLAUDE.md"),
    "Accepted at `D14.12`'s head on 2026-09-02.\n",
  );

  const files = (await inheritedDocuments(root)).map((f) => f.rel);
  assert.deepEqual(files, [".claude/README.md", "CLAUDE.md"]);
  await rm(root, { recursive: true, force: true });
});

/**
 * The prose and the source under a repo-relative directory, minus the excluded
 * paths. The extension list is the point rather than a filter for speed: the
 * scan has to be a pure function of tracked repository content or the task
 * around it cannot be cached (ADR-0026 §The rule). `.claude/` also holds
 * `settings.local.json`, which is git-ignored and per-machine — reading it
 * would red this test on one developer's clone and nowhere else.
 */
const SCANNED = new Set([".md", ".ts", ".tsx"]);

async function filesUnder(dir) {
  const out = [];
  const walk = async (full) => {
    for (const entry of await readdir(full, { withFileTypes: true })) {
      const child = path.join(full, entry.name);
      const rel = path.relative(repoRoot, child).split(path.sep).join("/");
      if (isExcluded(rel) || entry.name === "node_modules") continue;
      if (entry.isDirectory()) await walk(child);
      else if (SCANNED.has(path.extname(entry.name)))
        out.push({ full: child, rel });
    }
  };
  await walk(path.join(repoRoot, dir));
  return out;
}

test("nothing a fork inherits states the marketing app as present", async () => {
  // The Next.js app left this tree before either SPA shipped, and the
  // marketing site is a planned deliverable that scaffolds fresh. A skill or a
  // source comment that names its path in the present tense sends the reader
  // to a directory that is not there, and a fork inherits the claim. Both
  // trees travel: `.claude/` as the machinery that applies the records, and
  // `packages/ui/src` as code.
  const offenders = [];
  for (const dir of [".claude", "packages/ui/src"]) {
    for (const { full, rel } of await filesUnder(dir)) {
      const text = await readFile(full, "utf8");
      text.split(/\r?\n/).forEach((line, index) => {
        if (line.includes("apps/web")) offenders.push(`${rel}:${index + 1}`);
      });
    }
  }
  assert.deepEqual(offenders, []);
});

test("every workflow action is pinned to a commit digest", async () => {
  // A `uses:` on a moving tag (`actions/checkout@v4`) runs whatever that tag
  // points at on the day the job starts, with the workspace and the job's
  // token. Only a 40-hex commit digest is a reference the action's owner
  // cannot repoint (ADR-0073 §7); `helpers:pinGitHubActionDigests` in
  // `renovate.json` is what keeps the pin moving. Local composite steps
  // (`uses: ./…`) and container steps (`uses: docker://…`) are not tags and
  // are not pinned this way.
  const dir = path.join(repoRoot, ".github", "workflows");
  const files = (await readdir(dir)).filter((f) => /[.]ya?ml$/.test(f));
  assert.ok(files.length > 0, "no workflows found");

  const offenders = [];
  for (const file of files) {
    const text = await readFile(path.join(dir, file), "utf8");
    text.split(/\r?\n/).forEach((line, index) => {
      const match = /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(line);
      if (!match) return;
      const ref = match[1];
      if (ref.startsWith("./") || ref.startsWith("docker://")) return;
      if (!/@[0-9a-f]{40}$/.test(ref))
        offenders.push(`.github/workflows/${file}:${index + 1} ${ref}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test("one Node major, stated in every place that states one", async () => {
  // `.nvmrc`, the root `engines`, both workflows and the three Dockerfiles are
  // the runtime floor written down seven times, and the failure is always the
  // same one: a bump lands in some of them (ADR-0073 §4). The major is what is
  // compared, because each file states it at its own precision — `.nvmrc` and
  // the workflows a bare major, `engines` the patch line the dependency tree
  // actually needs, the images a tag.
  const major = (v) => /(\d+)/.exec(v)?.[1];
  const read = (rel) => readFile(path.join(repoRoot, rel), "utf8");

  const found = { ".nvmrc": major(await read(".nvmrc")) };

  const pkg = JSON.parse(await read("package.json"));
  found["package.json engines.node"] = major(pkg.engines.node);

  // Every occurrence, not the first: a workflow grows a second job and an
  // image a second build stage, and a floor that moved in one of them is the
  // drift this case exists to catch.
  const all = (text, pattern, label) => {
    const matches = [...text.matchAll(pattern)];
    assert.ok(matches.length > 0, `no Node version in ${label}`);
    matches.forEach((m, i) => {
      found[`${label}[${i}]`] = major(m[1]);
    });
  };

  for (const file of ["gate.yml", "e2e.yml"]) {
    all(
      await read(`.github/workflows/${file}`),
      /^\s*node-version:\s*(\S+)/gm,
      file,
    );
  }

  for (const app of ["api", "admin", "customer"]) {
    all(
      await read(`apps/${app}/Dockerfile`),
      /^FROM node:(\S+?)-/gm,
      `apps/${app}/Dockerfile`,
    );
  }

  const majors = new Set(Object.values(found));
  assert.equal(
    majors.size,
    1,
    `the Node major disagrees: ${JSON.stringify(found)}`,
  );
  assert.ok([...majors][0], "no Node version found");
});

// The behaviour specs (ADR-0068 §1): the real ones are clean, the scan
// reaches them, and each shape rule fires on the text it exists for.
test("the behaviour specs are clean", async () => {
  const violations = await scanSpecs();
  assert.deepEqual(
    violations.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.found}`),
    [],
  );
});

test("the spec scan covers docs/specs and skips its README", async () => {
  const files = (await specDocuments()).map((f) => f.rel);
  assert.ok(files.length > 0);
  assert.ok(files.every((f) => f.startsWith("docs/specs/")));
  assert.ok(!files.includes("docs/specs/README.md"));
});

const always = () => true;
const never = () => false;

const SPEC = `# X

## Requirement: A thing
It answers.
Records: [ADR-0012](../adr/0012-response-envelope.md)
Proved by: \`apps/api/test/envelope.int.test.ts\`

### Scenario: The case
- **WHEN** a client asks
- **THEN** it answers
`;

test("a well-formed spec passes", () => {
  assert.deepEqual(rules(checkSpec("s.md", SPEC, always)), []);
});

test("a requirement without a scenario is caught", () => {
  const text = SPEC.replace(/### Scenario:[\s\S]*$/, "");
  assert.deepEqual(rules(checkSpec("s.md", text, always)), [
    "spec-no-scenario",
  ]);
});

test("a scenario without a THEN is caught", () => {
  const text = SPEC.replace("- **THEN** it answers\n", "");
  assert.deepEqual(rules(checkSpec("s.md", text, always)), [
    "spec-scenario-shape",
  ]);
});

test("a scenario without a WHEN is caught", () => {
  const text = SPEC.replace("- **WHEN** a client asks\n", "");
  assert.deepEqual(rules(checkSpec("s.md", text, always)), [
    "spec-scenario-shape",
  ]);
});

test("a record or a test that does not exist is caught", () => {
  assert.deepEqual(rules(checkSpec("s.md", SPEC, never)), [
    "spec-record-missing",
    "spec-test-missing",
  ]);
});

test("a requirement with no Records: or Proved by: line is caught", () => {
  const text = SPEC.replace(/^Records:.*\n/m, "").replace(
    /^Proved by:.*\n/m,
    "",
  );
  assert.deepEqual(rules(checkSpec("s.md", text, always)), [
    "spec-record-missing",
    "spec-test-missing",
  ]);
});

test("a file with no requirement is caught", () => {
  assert.deepEqual(rules(checkSpec("s.md", "# Empty\n", always)), [
    "spec-empty",
  ]);
});

// The negative cases: each rule must actually fire on the text it exists for,
// or "clean" above means only that nothing was checked.
test("a step number is caught", () => {
  assert.deepEqual(rules(checkText("f.md", "Accepted at `D14.12`'s head.")), [
    "step-reference",
  ]);
});

test("a date is caught", () => {
  assert.deepEqual(
    rules(checkText("f.md", "Shipped 2026-09-02 with the ledger row.")),
    ["date"],
  );
});

test("a bare record range is caught", () => {
  assert.deepEqual(rules(checkText("f.md", "Condensed from ADRs 0030–0054.")), [
    "bare-range",
  ]);
  assert.deepEqual(rules(checkText("f.md", "ADRs 0001-0058 are frozen.")), [
    "bare-range",
  ]);
});

test("a window statement that does not link to the ledger is caught", () => {
  assert.deepEqual(
    rules(
      checkText("f.md", "The D14 window is open over the starter records."),
    ),
    ["unlinked-window"],
  );
  assert.deepEqual(rules(checkText("f.md", "No amendment window is open.")), [
    "unlinked-window",
  ]);
});

test("a window statement that links to the ledger passes", () => {
  assert.deepEqual(
    rules(
      checkText(
        "f.md",
        `Which window is open is stated in [the ledger](../docs/${LEDGER_WINDOW}).`,
      ),
    ),
    [],
  );
});

test("the window rule does not fire on the ordinary word", () => {
  assert.deepEqual(
    rules(checkText("f.md", "kept only for the grace window, then discarded")),
    [],
  );
  assert.deepEqual(
    rules(checkText("f.md", "Clear `window.localStorage` between tests.")),
    [],
  );
});

test("the placeholders the skills teach are not violations", () => {
  assert.deepEqual(
    rules(
      checkText("f.md", "Label it `**Amended YYYY-MM-DD (D<n>.<step>).**`"),
    ),
    [],
  );
  assert.deepEqual(
    rules(checkText("f.md", "The row moves to `shipped YYYY-MM-DD`.")),
    [],
  );
});
